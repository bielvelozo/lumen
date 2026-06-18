/**
 * Cross-spec data shapes for the secrets/tokens module (spec 02). Types and Zod
 * only — NO `node:crypto` here (this package stays free of Node globals; the
 * implementation lives in `apps/api/src/crypto`). Consumed by specs 04 (email
 * verification) and 05 (login/sessions/refresh) at the row level.
 */
import { z } from 'zod';

/**
 * A freshly generated disposable token. The `raw` value is shown exactly once
 * (email link / httpOnly cookie) and is the ONLY place the plaintext exists; only
 * `tokenHash` is ever persisted (constitution invariant 4).
 */
export interface DisposableToken {
  /** High-entropy raw token (base64url). Exists only here + the email link/cookie. */
  raw: string;
  /** SHA-256 hex hash of `raw` — the only value written to the DB (`token_hash`). */
  tokenHash: string;
}

/**
 * The freshness-relevant columns of a disposable-token row (e.g.
 * `email_verification_tokens`, `refresh_tokens`). The crypto module supplies the
 * single-use/expiry DECISION over these; the calling spec owns the table writes.
 */
export interface TokenRecordState {
  /** Set once the token has been redeemed; a non-null value means "already used". */
  usedAt: Date | null;
  /** Set when the token was explicitly revoked (refresh rotation/logout). */
  revokedAt: Date | null;
  /** Hard expiry; the token is stale once `now >= expiresAt`. */
  expiresAt: Date;
}

/** Why a token row is (not) usable. Checked in precedence order. */
export type TokenFreshnessReason = 'ok' | 'revoked' | 'used' | 'expired';

/** Result of the pure freshness check over a {@link TokenRecordState}. */
export interface TokenFreshness {
  /** `true` only when `reason === 'ok'`. */
  fresh: boolean;
  reason: TokenFreshnessReason;
}

/** Zod mirror of {@link DisposableToken} for any spec that needs runtime validation. */
export const disposableTokenSchema = z.object({
  raw: z.string().min(1),
  tokenHash: z.string().length(64),
});
