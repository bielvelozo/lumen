import { streamText, tool, stepCountIs, APICallError } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { AiConnectErrorCategory } from '@lumen/shared';
import { categorizeProviderError } from '../ai-connection/claude-validator';
import type { ExecutableTool } from './query-tools';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRunInput {
  apiKey: string;
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ExecutableTool[];
  maxSteps: number;
}

export interface ChatRunHandlers {
  /** Called for each streamed text chunk of the final answer. */
  onTextDelta(delta: string): void;
}

export type ChatRunResult =
  | { outcome: 'answered'; text: string }
  | { outcome: 'refusal' }
  | { outcome: 'step_limit' }
  | { outcome: 'error'; category: AiConnectErrorCategory };

// Each assistant message after a tool call opens a new text block, and the deltas carry no
// whitespace between blocks: "…ao mesmo tempo! 🔍Aqui está o resumo".
export function textBlockSeparator(textSoFar: string): string {
  if (textSoFar.trim().length === 0 || textSoFar.endsWith('\n\n')) return '';
  return textSoFar.endsWith('\n') ? '\n' : '\n\n';
}

/**
 * Port encapsulating the ENTIRE model interaction — the tool-calling loop + streaming. The
 * orchestrator provides the system prompt, history, and backend-executed tools; the port drives
 * Claude, streams text deltas, and returns a typed outcome. CI binds a fake; the real adapter
 * uses the Vercel AI SDK. The model never sees the MySQL credential and never emits SQL — it
 * only picks a tool name + params, which the tool's `execute` validates + runs (spec 12).
 */
export interface ChatModelPort {
  run(input: ChatRunInput, handlers: ChatRunHandlers): Promise<ChatRunResult>;
}

export function createAiSdkChatModel(): ChatModelPort {
  return {
    async run(input, handlers): Promise<ChatRunResult> {
      const provider = createAnthropic({ apiKey: input.apiKey });
      const aiTools = Object.fromEntries(
        input.tools.map((t) => [
          t.name,
          tool({
            description: t.description,
            inputSchema: t.inputSchema,
            execute: async (args: unknown) => t.execute(args),
          }),
        ]),
      );

      try {
        const result = streamText({
          model: provider(input.model),
          system: input.system,
          messages: input.messages,
          tools: aiTools,
          stopWhen: stepCountIs(input.maxSteps),
        });

        let text = '';
        const emit = (delta: string): void => {
          text += delta;
          handlers.onTextDelta(delta);
        };
        for await (const part of result.fullStream) {
          if (part.type === 'text-start') {
            const separator = textBlockSeparator(text);
            if (separator) emit(separator);
          } else if (part.type === 'text-delta') {
            emit(part.text);
          } else if (part.type === 'error') {
            throw part.error;
          }
        }

        const finishReason = await result.finishReason;
        if (finishReason === 'content-filter') return { outcome: 'refusal' };
        // Stopped at the step cap without composing a final answer.
        if (finishReason === 'tool-calls' && text.length === 0) return { outcome: 'step_limit' };
        return { outcome: 'answered', text };
      } catch (error) {
        if (APICallError.isInstance(error) || error instanceof Error) {
          return { outcome: 'error', category: categorizeProviderError(error) };
        }
        return { outcome: 'error', category: 'unknown' };
      }
    },
  };
}
