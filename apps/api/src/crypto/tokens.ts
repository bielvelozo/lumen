import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import type { DisposableToken, TokenRecordState, TokenFreshness } from '@lumen/shared';

/**
 * Disposable-token primitives (email-verification, refresh) — constitution
 * invariant 4: the DB stores only the HASH; the raw value lives solely in the email
 * link / httpOnly cookie. A fast hash (SHA-256, unsalted) is correct here because
 * the input is already high-entropy CSPRNG output — unlike a password, it needs no
 * salt or work factor. Single-use/expiry state is decided by {@link tokenFreshness};
 * the calling spec (04/05) owns the actual row writes.
 */

/** Raw token entropy in bytes (≥32 per spec 02). */
const TOKEN_BYTES = 32;

/**
 * Generate a high-entropy disposable token. The returned `raw` is the only place
 * the plaintext exists — persist `tokenHash`, hand `raw` to the email link/cookie,
 * then discard it.
 */
export function generateToken(): DisposableToken {
  const raw = randomBytes(TOKEN_BYTES).toString('base64url');
  return { raw, tokenHash: hashToken(raw) };
}

/** SHA-256 hex hash of a raw token. Deterministic: the same raw always maps here. */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Constant-time check that `raw` hashes to `storedHash`. Compares the hex digests
 * with `timingSafeEqual` so a mismatch reveals nothing through timing. A
 * length-mismatched `storedHash` (malformed row) returns `false` rather than
 * throwing.
 */
export function verifyTokenHash(raw: string, storedHash: string): boolean {
  const computed = Buffer.from(hashToken(raw), 'utf8');
  const stored = Buffer.from(storedHash, 'utf8');
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}

/**
 * Pure single-use/expiry decision over a token row, in precedence order:
 * revoked → used → expired → ok. The caller applies the verdict and owns the
 * `used_at` / `revoked_at` writes; this module never touches the DB.
 *
 * @param state the freshness-relevant columns of the token row
 * @param now the reference time (injected so the decision is deterministic/testable)
 */
export function tokenFreshness(state: TokenRecordState, now: Date): TokenFreshness {
  if (state.revokedAt !== null) return { fresh: false, reason: 'revoked' };
  if (state.usedAt !== null) return { fresh: false, reason: 'used' };
  if (now.getTime() >= state.expiresAt.getTime()) return { fresh: false, reason: 'expired' };
  return { fresh: true, reason: 'ok' };
}
