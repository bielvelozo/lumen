import type { VerifyEmailStatus, ResendVerificationResponse } from '@lumen/shared';
import type { VerificationStore } from './verification.store';
import type { EmailSender } from './email-sender';
import type { RateLimiter } from './rate-limiter';
import type { VerificationTrigger } from './verification-trigger';
import { buildVerificationEmail } from './verification-template';

/** Default verification-token lifetime: 24h (spec 04 open-question default). */
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The single generic resend response. Returned for existing-unverified, already-verified,
 * AND unknown emails so the endpoint never reveals account existence/verification state.
 */
const RESEND_OK: ResendVerificationResponse = {
  message: 'If that address needs verifying, we just sent a new confirmation link.',
};

export interface VerificationServiceDeps {
  store: VerificationStore;
  emailSender: EmailSender;
  rateLimiter: RateLimiter;
  /** spec 02 `generateToken` — 32-byte CSPRNG raw + its SHA-256 hash. */
  generateToken(): { raw: string; tokenHash: string };
  /** spec 02 `hashToken` — SHA-256 hex of a raw token. */
  hashToken(raw: string): string;
  /** Public SPA base URL for the verify link (`{appUrl}/verify-email?token=`). */
  appUrl: string;
  ttlMs?: number;
  now?: () => Date;
}

/**
 * Email-verification service. Also implements the spec-03 {@link VerificationTrigger}
 * (`triggerForNewUser`), so wiring it into signup replaces the no-op with the real flow.
 */
export interface VerificationService extends VerificationTrigger {
  /** Hash the link token and atomically consume it; returns the outcome. */
  verifyEmail(rawToken: string): Promise<VerifyEmailStatus>;
  /** (Re)issue a link for an existing-unverified email; always returns the generic response. */
  resendVerification(email: string): Promise<ResendVerificationResponse>;
}

export function createVerificationService(deps: VerificationServiceDeps): VerificationService {
  const now = deps.now ?? ((): Date => new Date());
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;

  /**
   * Mint a token, persist only its hash, and email the raw token as a link. Best-effort:
   * a send failure is swallowed (signup/resend never hard-fail) and logged WITHOUT the
   * link or token. The raw token exists only in `link`.
   */
  async function issueVerification(userId: string, email: string): Promise<void> {
    const { raw, tokenHash } = deps.generateToken();
    const expiresAt = new Date(now().getTime() + ttlMs);
    await deps.store.issue(userId, tokenHash, expiresAt);

    const link = `${deps.appUrl}/verify-email?token=${encodeURIComponent(raw)}`;
    const message = buildVerificationEmail(email, link);
    try {
      await deps.emailSender.send(message);
    } catch (error) {
      // Sanitized — never the link/token/email.
      console.warn(
        `[email] verification send failed (sanitized): ${error instanceof Error ? error.name : 'error'}`,
      );
    }
  }

  return {
    async triggerForNewUser(userId: string, email: string): Promise<void> {
      await issueVerification(userId, email);
    },

    async verifyEmail(rawToken: string): Promise<VerifyEmailStatus> {
      const tokenHash = deps.hashToken(rawToken);
      return deps.store.consume(tokenHash, now());
    },

    async resendVerification(email: string): Promise<ResendVerificationResponse> {
      // Rate-limit per email first — an over-limit (or unknown) email still gets the same
      // generic response, so neither existence nor limit state leaks.
      if (!deps.rateLimiter.consume(email)) {
        return RESEND_OK;
      }
      const user = await deps.store.findUserByEmail(email);
      if (user && !user.emailVerified) {
        await issueVerification(user.id, email);
      }
      return RESEND_OK;
    },
  };
}
