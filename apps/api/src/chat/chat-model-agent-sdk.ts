import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSdkMcpServer, query, tool } from '@anthropic-ai/claude-agent-sdk';
import { ZodEffects, ZodObject, type ZodRawShape, type ZodType } from 'zod';
import type { AiConnectErrorCategory } from '@lumen/shared';
import type { ChatMessage, ChatModelPort, ChatRunResult } from './chat-model';

export interface AgentSdkChatModelOptions {
  oauthToken?: string;
  timeoutMs?: number;
}

const MCP_SERVER_NAME = 'lumen';
const DEFAULT_TIMEOUT_MS = 180_000;

// The Claude Code subprocess reads CLAUDE.md/settings from cwd; point it at an empty dir so the
// only context the model sees is the Lumen system prompt.
function isolatedWorkDir(): string {
  const dir = join(tmpdir(), 'lumen-agent-sdk');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function rawShape(schema: ZodType): ZodRawShape {
  let current: unknown = schema;
  while (current instanceof ZodEffects) current = current._def.schema;
  if (current instanceof ZodObject) return current.shape as ZodRawShape;
  throw new Error('query tool schema must be a Zod object');
}

function toPrompt(messages: ChatMessage[]): string {
  const last = messages[messages.length - 1];
  const prior = messages.slice(0, -1);
  if (!last) return '';
  if (prior.length === 0) return last.content;
  const lines = prior.map((m) => `${m.role === 'user' ? 'Usuário' : 'Assistente'}: ${m.content}`);
  return `Conversa até aqui:\n${lines.join('\n')}\n\nNova pergunta do usuário:\n${last.content}`;
}

function categorize(errors: readonly string[]): AiConnectErrorCategory {
  const text = errors.join(' ').toLowerCase();
  if (/authenticat|oauth|unauthorized|401|not logged in|login/.test(text)) return 'invalid_key';
  if (/rate limit|429|overloaded|usage limit/.test(text)) return 'rate_limited';
  if (/network|econn|fetch failed|timed? ?out|enotfound/.test(text)) return 'network';
  return 'unknown';
}

export function createAgentSdkChatModel(opts: AgentSdkChatModelOptions = {}): ChatModelPort {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const workDir = isolatedWorkDir();
  const env: Record<string, string | undefined> = {
    ...process.env,
    CLAUDE_AGENT_SDK_CLIENT_APP: 'lumen/0.0.0',
    ...(opts.oauthToken ? { CLAUDE_CODE_OAUTH_TOKEN: opts.oauthToken } : {}),
  };

  return {
    async run(input, handlers): Promise<ChatRunResult> {
      const mcpTools = input.tools.map((t) =>
        tool(t.name, t.description, rawShape(t.inputSchema), async (args: unknown) => {
          const result = await t.execute(args);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], isError: !result.ok };
        }),
      );
      const allowedTools = input.tools.map((t) => `mcp__${MCP_SERVER_NAME}__${t.name}`);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let text = '';

      try {
        const stream = query({
          prompt: toPrompt(input.messages),
          options: {
            model: input.model,
            systemPrompt: input.system,
            tools: [],
            allowedTools,
            mcpServers: { [MCP_SERVER_NAME]: createSdkMcpServer({ name: MCP_SERVER_NAME, tools: mcpTools }) },
            permissionMode: 'default',
            includePartialMessages: true,
            persistSession: false,
            settingSources: [],
            cwd: workDir,
            maxTurns: input.maxSteps,
            abortController: controller,
            env,
            stderr: (line) => console.warn(`[agent-sdk] ${line.slice(0, 500)}`),
          },
        });

        for await (const message of stream) {
          if (message.type === 'stream_event') {
            const event = message.event;
            if (
              message.parent_tool_use_id === null &&
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              text += event.delta.text;
              handlers.onTextDelta(event.delta.text);
            }
          } else if (message.type === 'result') {
            if (message.subtype === 'success') {
              if (text.length === 0 && message.result) {
                text = message.result;
                handlers.onTextDelta(text);
              }
              return { outcome: 'answered', text };
            }
            if (message.subtype === 'error_max_turns') return { outcome: 'step_limit' };
            console.warn(`[agent-sdk] run failed (${message.subtype}): ${message.errors.join(' | ').slice(0, 500)}`);
            return { outcome: 'error', category: categorize(message.errors) };
          }
        }
        return text.length > 0 ? { outcome: 'answered', text } : { outcome: 'error', category: 'unknown' };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[agent-sdk] run threw: ${message.slice(0, 500)}`);
        return { outcome: 'error', category: controller.signal.aborted ? 'network' : categorize([message]) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
