import { describe, it, expect } from 'vitest';
import type { TokenRecordState } from '@lumen/shared';
import { generateToken, hashToken, verifyTokenHash, tokenFreshness } from './tokens';

describe('disposable tokens', () => {
  it('generates a high-entropy raw token and its hash', () => {
    const { raw, tokenHash } = generateToken();
    // 32 bytes base64url -> 43 chars (no padding).
    expect(raw.length).toBeGreaterThanOrEqual(43);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/); // base64url alphabet
    expect(tokenHash).toBe(hashToken(raw));
  });

  it('produces unique raw tokens across calls', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(generateToken().raw);
    expect(seen.size).toBe(100);
  });

  it('hashToken is a deterministic 64-char SHA-256 hex digest', () => {
    const hash = hashToken('some-raw-token');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken('some-raw-token')).toBe(hash);
    expect(hashToken('other')).not.toBe(hash);
  });

  it('verifyTokenHash matches the right token and rejects a wrong one', () => {
    const { raw, tokenHash } = generateToken();
    expect(verifyTokenHash(raw, tokenHash)).toBe(true);
    expect(verifyTokenHash('wrong', tokenHash)).toBe(false);
  });

  it('verifyTokenHash returns false (no throw) for a malformed stored hash', () => {
    expect(verifyTokenHash('whatever', 'short')).toBe(false);
    expect(verifyTokenHash('whatever', '')).toBe(false);
  });

  describe('tokenFreshness', () => {
    const now = new Date('2026-06-18T12:00:00Z');
    const future = new Date('2026-06-18T13:00:00Z');
    const past = new Date('2026-06-18T11:00:00Z');
    const base: TokenRecordState = { usedAt: null, revokedAt: null, expiresAt: future };

    it('is fresh when unused, unrevoked, and unexpired', () => {
      expect(tokenFreshness(base, now)).toEqual({ fresh: true, reason: 'ok' });
    });

    it('reports expired once now >= expiresAt', () => {
      expect(tokenFreshness({ ...base, expiresAt: past }, now)).toEqual({
        fresh: false,
        reason: 'expired',
      });
      expect(tokenFreshness({ ...base, expiresAt: now }, now).reason).toBe('expired');
    });

    it('reports used when used_at is set', () => {
      expect(tokenFreshness({ ...base, usedAt: past }, now).reason).toBe('used');
    });

    it('prefers revoked over used and expired', () => {
      const revokedUsedExpired: TokenRecordState = {
        usedAt: past,
        revokedAt: past,
        expiresAt: past,
      };
      expect(tokenFreshness(revokedUsedExpired, now).reason).toBe('revoked');
    });
  });
});
