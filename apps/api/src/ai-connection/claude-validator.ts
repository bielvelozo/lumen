import { generateText, APICallError } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { redactSecretStrings, type AiConnectErrorCategory, type ClaudeModelId } from '@lumen/shared';

/**
 * The result of proving a Claude key works against a chosen model. On failure we carry ONLY a
 * sanitized category — never the raw provider text (which can leak request internals or key
 * fragments). spec 11 / constitution invariant on secrets.
 */
export type ValidationResult =
  | { outcome: 'valid' }
  | { outcome: 'invalid'; category: AiConnectErrorCategory };

/**
 * Port: prove a pasted/stored key works by issuing one minimal completion. The real adapter
 * uses the Vercel AI SDK + Anthropic provider; tests bind a fake. The plaintext key is passed
 * in, used for one call, and never stored or logged by this port.
 */
export interface ClaudeValidator {
  validate(apiKey: string, model: ClaudeModelId): Promise<ValidationResult>;
}

/**
 * Map a provider/transport error to the CLOSED safe category set. This is the security-
 * critical sanitization seam — the raw error is discarded here and never reaches `last_error`,
 * a response, or a log. Mapping per the `claude-api` reference (shared/error-codes.md):
 *   401 auth / 403 permission -> invalid_key
 *   404 not_found             -> model_unavailable
 *   429 rate_limit            -> rate_limited
 *   timeout / DNS / 5xx / 529 -> network
 *   anything else             -> unknown
 */
export function categorizeProviderError(error: unknown): AiConnectErrorCategory {
  // A bounded-timeout abort (AbortSignal.timeout) or a transport abort -> network.
  if (isAbortError(error)) return 'network';

  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === 401 || status === 403) return 'invalid_key';
    if (status === 404) return 'model_unavailable';
    if (status === 429) return 'rate_limited';
    // No HTTP status = network-level failure (DNS, connection reset). 5xx / 529 overloaded.
    if (status === undefined || status >= 500) return 'network';
    return 'unknown';
  }
  return 'unknown';
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/**
 * The real validator: a single minimal completion (tiny prompt, `maxOutputTokens` ~4) against
 * the chosen model, behind a bounded server-side timeout so a wedged provider surfaces as
 * `network` rather than hanging the request. `maxRetries: 0` keeps it a single side-effect.
 * Used in production; CI binds {@link createFakeValidator}-style fakes instead.
 */
export function createAiSdkValidator(opts: { timeoutMs?: number } = {}): ClaudeValidator {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return {
    async validate(apiKey, model) {
      const provider = createAnthropic({ apiKey });
      try {
        await generateText({
          model: provider(model),
          prompt: 'ping',
          maxOutputTokens: 4,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(timeoutMs),
        });
        return { outcome: 'valid' };
      } catch (error) {
        const category = categorizeProviderError(error);
        console.warn(`[ai-connection] key validation failed (${category}): ${describeProviderError(error)}`);
        return { outcome: 'invalid', category };
      }
    },
  };
}

// Operator-facing diagnostic for the server log only. Carries the HTTP status and the provider's
// own error type/message (e.g. "credit balance is too low"), never the request — the key lives
// only in the request headers, which are not part of the error. Secret-shaped substrings are
// redacted anyway as a backstop.
function describeProviderError(error: unknown): string {
  if (APICallError.isInstance(error)) {
    let detail = '';
    if (typeof error.responseBody === 'string' && error.responseBody.length > 0) {
      try {
        const body = JSON.parse(error.responseBody) as { error?: { type?: string; message?: string } };
        detail = ` type=${body.error?.type ?? '?'} message="${body.error?.message ?? ''}"`;
      } catch {
        detail = ` body=${error.responseBody.slice(0, 200)}`;
      }
    }
    return redactSecretStrings(`status=${error.statusCode ?? 'none'}${detail}`);
  }
  if (error instanceof Error) return redactSecretStrings(`${error.name}: ${error.message}`);
  return 'non-Error thrown';
}
