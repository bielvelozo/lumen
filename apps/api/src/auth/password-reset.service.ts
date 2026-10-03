import type { ForgotPasswordResponse } from '@lumen/shared';
import type { PasswordResetStore } from './password-reset.store';
import type { EmailSender } from './email-sender';
import type { RateLimiter } from './rate-limiter';
import { buildPasswordResetEmail } from './password-reset-template';

/** Reset-token lifetime: 1h — much shorter than verification, since it hands over an account. */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

/**
 * The single generic response. Returned for a known AND an unknown address so the endpoint
 * never reveals whether an account exists.
 */
const FORGOT_OK: ForgotPasswordResponse = {
  message: 'Se existir uma conta com esse e-mail, enviamos um link para redefinir a senha.',
};

export interface PasswordResetServiceDeps {
  store: PasswordResetStore;
  emailSender: EmailSender;
  rateLimiter: RateLimiter;
  /** spec 02 `generateToken` — 32-byte CSPRNG raw + its SHA-256 hash. */
  generateToken(): { raw: string; tokenHash: string };
  /** spec 02 `hashToken` — SHA-256 hex of a raw token. */
  hashToken(raw: string): string;
  /** argon2id hashing for the new password — the same one signup uses. */
  hashPassword(plain: string): Promise<string>;
  /** Public SPA base URL for the reset link (`{appUrl}/reset-password?token=`). */
  appUrl: string;
  ttlMs?: number;
  now?: () => Date;
}

export interface PasswordResetService {
  /** Issue a reset link for an existing email; always returns the generic response. */
  requestReset(email: string): Promise<ForgotPasswordResponse>;
  /** Consume the link token and set the new password. False ⇒ unusable link. */
  resetPassword(rawToken: string, newPassword: string): Promise<boolean>;
}

export function createPasswordResetService(deps: PasswordResetServiceDeps): PasswordResetService {
  const now = deps.now ?? ((): Date => new Date());
  const ttlMs = deps.ttlMs ?? DEFAULT_TTL_MS;

  return {
    async requestReset(email: string): Promise<ForgotPasswordResponse> {
      // Rate-limit per email FIRST — an over-limit (or unknown) address still gets the same
      // response, so neither existence nor limit state leaks.
      if (!deps.rateLimiter.consume(email)) return FORGOT_OK;

      const userId = await deps.store.findUserIdByEmail(email);
      if (!userId) return FORGOT_OK;

      const { raw, tokenHash } = deps.generateToken();
      await deps.store.issue(userId, tokenHash, new Date(now().getTime() + ttlMs));

      const link = `${deps.appUrl}/reset-password?token=${encodeURIComponent(raw)}`;
      try {
        await deps.emailSender.send(buildPasswordResetEmail(email, link));
      } catch (error) {
        // Sanitized — never the link/token/email.
        console.warn(
          `[email] password-reset send failed (sanitized): ${error instanceof Error ? error.name : 'error'}`,
        );
      }
      return FORGOT_OK;
    },

    async resetPassword(rawToken: string, newPassword: string): Promise<boolean> {
      // Hashing before the token is proven costs an argon2 pass on a bad link — which is a
      // fine brake, and it keeps the whole write inside the store's single transaction.
      const passwordHash = await deps.hashPassword(newPassword);
      return deps.store.consume(deps.hashToken(rawToken), now(), passwordHash);
    },
  };
}
