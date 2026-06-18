/**
 * AI-connection contracts (spec 11). The owner pastes their Claude API key (BYO); the server
 * validates it with a real minimal completion, encrypts it, and reports a SANITIZED public
 * state. No `org_id` is ever accepted from the client (anti-IDOR); the key is never returned;
 * no raw provider error is ever surfaced (only a safe category).
 */
import { z } from 'zod';
import { CONNECTION_STATUSES } from './db-contracts';

/**
 * The curated, selectable Claude models — the SINGLE SOURCE OF TRUTH for the selector AND
 * server-side validation. EXACT alias ids, NO date suffixes. Verified against the project
 * `claude-api` reference (shared/models.md) on 2026-06-18 — see DECISIONS.md. Kept small and
 * current (Opus 4.7 intentionally omitted).
 */
export const CLAUDE_MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
] as const;

export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]['id'];

/** The default `default_model` for a new connection. */
export const DEFAULT_MODEL: ClaudeModelId = 'claude-opus-4-8';

const MODEL_IDS = CLAUDE_MODELS.map((m) => m.id) as [ClaudeModelId, ...ClaudeModelId[]];

/** A submitted model MUST be one of the curated ids — rejected before any provider call. */
export const aiModelSchema = z.enum(MODEL_IDS);

/**
 * The CLOSED set of safe error categories. A raw Anthropic/provider error is mapped to one of
 * these before it touches `last_error`, the response, or logs (raw text can leak request
 * internals or key fragments).
 */
export const AI_CONNECT_ERROR_CATEGORIES = [
  'invalid_key',
  'model_unavailable',
  'rate_limited',
  'network',
  'unknown',
] as const;

export type AiConnectErrorCategory = (typeof AI_CONNECT_ERROR_CATEGORIES)[number];

/**
 * `PUT /ai-connection` request. `.strict()` rejects unknown fields (no `org_id` / connection
 * id). `apiKey` is optional: present = paste/re-key (validate the new key); absent =
 * re-validate the STORED key (e.g. a model change) — never re-paste required. The key, when
 * present, is non-empty and exists only to be validated + encrypted, never echoed.
 */
export const connectAiRequestSchema = z
  .object({
    apiKey: z.string().min(1).max(512).optional(),
    model: aiModelSchema,
  })
  .strict();

export type ConnectAiRequest = z.infer<typeof connectAiRequestSchema>;

/**
 * The public AI-connection state returned by `GET /ai-connection` and by the connect mutation.
 * Carries NO secret — `hasKey` signals a stored key exists, but the key itself is never here.
 */
export const aiConnectStateSchema = z.object({
  provider: z.literal('claude'),
  hasKey: z.boolean(),
  defaultModel: aiModelSchema.nullable(),
  status: z.enum(CONNECTION_STATUSES).nullable(),
  lastValidatedAt: z.string().nullable(),
  lastError: z.enum(AI_CONNECT_ERROR_CATEGORIES).nullable(),
});

export type AiConnectState = z.infer<typeof aiConnectStateSchema>;
