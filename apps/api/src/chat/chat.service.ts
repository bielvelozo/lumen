import { DEFAULT_MODEL, type ChatErrorCode, type ClaudeModelId } from '@lumen/shared';
import type { ChatStore } from './chat.store';
import type { FunctionLogStore } from './function-log.store';
import type { AiConnectionStore } from '../ai-connection/ai-connection.store';
import type { AllowListAccessor, ExposedAllowList } from '../query-registry/allow-list';
import type { QueryRunner } from '../query-registry/query-runner';
import type { ChatModelPort } from './chat-model';
import { buildQueryTools } from './query-tools';
import { buildSystemPrompt } from './system-prompt';
import { chatErrorFromCategory, CHAT_ERROR_MESSAGES } from './sanitize';

const EMPTY_ALLOW_LIST: ExposedAllowList = { tables: new Map(), relationships: [] };
const DEFAULT_MAX_STEPS = 5;
const DEFAULT_HISTORY_LIMIT = 10;
const TITLE_MAX = 60;

export interface ChatServiceDeps {
  chatStore: ChatStore;
  logStore: FunctionLogStore;
  aiConnectionStore: AiConnectionStore;
  allowListAccessor: AllowListAccessor;
  runner: QueryRunner;
  modelPort: ChatModelPort;
  /** spec 02 — decrypt the Claude key in-process; the plaintext is discarded after the call. */
  decrypt(blob: Buffer): string;
  maxSteps?: number;
  historyLimit?: number;
  /** When set, no per-org key is loaded: the port authenticates with the operator's login. */
  subscription?: { defaultModel: ClaudeModelId };
}

export interface SendMessageInput {
  orgId: string;
  userId: string;
  /** A session already confirmed to belong to `orgId` (the route enforces ownership → 404). */
  sessionId: string;
  message: string;
  /** A curated model the user picked in the switcher; overrides the org default for this turn. */
  modelOverride?: ClaudeModelId;
}

export type SendMessageOutcome =
  | { outcome: 'answered'; messageId: string; model: string }
  | { outcome: 'error'; code: ChatErrorCode; message: string };

export interface ChatStreamSink {
  onTextDelta(delta: string): void;
}

function deriveTitle(message: string): string {
  const trimmed = message.trim().replace(/\s+/g, ' ');
  return trimmed.length <= TITLE_MAX ? trimmed : `${trimmed.slice(0, TITLE_MAX - 1)}…`;
}

export interface ChatService {
  sendMessage(input: SendMessageInput, sink: ChatStreamSink): Promise<SendMessageOutcome>;
}

export function createChatService(deps: ChatServiceDeps): ChatService {
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const historyLimit = deps.historyLimit ?? DEFAULT_HISTORY_LIMIT;

  function fail(code: ChatErrorCode): SendMessageOutcome {
    return { outcome: 'error', code, message: CHAT_ERROR_MESSAGES[code] };
  }

  return {
    async sendMessage(input, sink): Promise<SendMessageOutcome> {
      // Persist the user turn FIRST so it survives a stream that dies mid-flight, and set the
      // session title (first message only) + bump updated_at so the session list is meaningful.
      await deps.chatStore.insertUserMessage({
        sessionId: input.sessionId,
        orgId: input.orgId,
        content: input.message,
      });
      await deps.chatStore.touchSession(input.sessionId, input.orgId, deriveTitle(input.message));

      let apiKey = '';
      let model: string;
      if (deps.subscription) {
        model = input.modelOverride ?? deps.subscription.defaultModel;
      } else {
        // The Claude key must be connected + active; decrypt in-process (discarded after the call).
        const aiConn = await deps.aiConnectionStore.getByOrg(input.orgId);
        if (!aiConn || aiConn.status !== 'active') return fail('ai_not_connected');
        try {
          apiKey = deps.decrypt(aiConn.encryptedApiKey);
        } catch {
          // An unreadable stored key is a dead connection, not a 500.
          return fail('ai_key_invalid');
        }
        // The user's per-turn switcher choice wins, then the org default, then the curated default.
        model = input.modelOverride ?? (aiConn.defaultModel as ClaudeModelId | null) ?? DEFAULT_MODEL;
      }

      // Exposed tables (for the system prompt) — null when no DB connection; tools still refuse.
      const access = await deps.allowListAccessor.getByOrg(input.orgId);
      const system = buildSystemPrompt(access?.allowList ?? EMPTY_ALLOW_LIST);

      const tools = buildQueryTools({
        orgId: input.orgId,
        userId: input.userId,
        sessionId: input.sessionId,
        model,
        accessor: deps.allowListAccessor,
        runner: deps.runner,
        logStore: deps.logStore,
      });

      // History (oldest-first) includes the just-saved user message as the latest turn.
      const history = await deps.chatStore.recentMessages(input.sessionId, input.orgId, historyLimit);

      const result = await deps.modelPort.run(
        { apiKey, model, system, messages: history, tools, maxSteps },
        { onTextDelta: sink.onTextDelta },
      );

      if (result.outcome === 'answered') {
        const saved = await deps.chatStore.insertAssistantMessage({
          sessionId: input.sessionId,
          orgId: input.orgId,
          content: result.text,
          model,
        });
        await deps.chatStore.touchSession(input.sessionId, input.orgId);
        return { outcome: 'answered', messageId: saved.id, model };
      }

      if (result.outcome === 'refusal') return fail('model_refused');
      if (result.outcome === 'step_limit') return fail('step_limit');
      return fail(chatErrorFromCategory(result.category));
    },
  };
}
