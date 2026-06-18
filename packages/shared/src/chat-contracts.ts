/**
 * Chat orchestrator contracts (spec 13, Flow 4). The owner sends a message; the backend runs a
 * tool-calling loop with Claude (the model picks a registry function, the backend executes it
 * read-only) and STREAMS the answer. No `org_id`/`session_id` is ever accepted in the body
 * (anti-IDOR) — the session id is a path param validated against the JWT org; org/user come from
 * the JWT. The stream wire format below is the contract `apps/web` (spec 14) consumes.
 */
import { z } from 'zod';
import { aiModelSchema } from './ai-contracts';

/**
 * `POST /chat/sessions/:id/messages` body. `message` only, plus an OPTIONAL `model` override
 * (a curated Claude id) the user picked in the switcher — the orchestrator uses it over the
 * org default and records it on `messages.model`. `.strict()` still rejects a smuggled
 * `org_id`/`session_id` (anti-IDOR).
 */
export const sendMessageRequestSchema = z
  .object({
    message: z.string().trim().min(1, 'Message is required').max(4000),
    model: aiModelSchema.optional(),
  })
  .strict();

export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

/** `PATCH /chat/sessions/:id` body — rename only (no ids; org from the JWT). */
export const renameSessionRequestSchema = z
  .object({
    title: z.string().trim().min(1, 'Title is required').max(120),
  })
  .strict();

export type RenameSessionRequest = z.infer<typeof renameSessionRequestSchema>;

/**
 * CLOSED set of sanitized, user-facing chat error codes. Each maps to a deterministic message;
 * raw provider/driver text is never surfaced.
 */
export const CHAT_ERROR_CODES = [
  'ai_not_connected',
  'ai_key_invalid',
  'ai_rate_limited',
  'ai_unavailable',
  'model_refused',
  'data_source_unavailable',
  'step_limit',
  'unknown',
] as const;
export type ChatErrorCode = (typeof CHAT_ERROR_CODES)[number];

/**
 * The streamed wire format (SSE `data:` JSON events), in order:
 *   `text-delta`* (zero or more) then exactly ONE terminal `done` OR `error`.
 */
export type ChatStreamEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'done'; messageId: string; model: string }
  | { type: 'error'; code: ChatErrorCode; message: string };

/** A chat session as the UI lists it (no secrets). */
export interface ChatSessionSummary {
  id: string;
  title: string | null;
  updatedAt: string;
}

/** A persisted message as the UI renders it. */
export interface ChatMessageDTO {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  createdAt: string;
}

/** `POST /chat/sessions` response. */
export interface CreateChatSessionResponse {
  id: string;
}
