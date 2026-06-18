import { describe, it, expect, vi } from 'vitest';
import type { LoginUser, RotateRefreshResult } from './session.store';
import { createAuthService, type AuthServiceDeps } from './auth.service';

const USER: LoginUser = {
  id: '11111111-1111-1111-1111-111111111111',
  orgId: '22222222-2222-2222-2222-222222222222',
  email: 'owner@example.com',
  passwordHash: '$argon2id$real-hash',
  emailVerified: true,
};

function build(overrides: {
  user?: LoginUser | null;
  passwordOk?: boolean;
  rateOk?: boolean;
  rotate?: RotateRefreshResult;
} = {}) {
  const findUserByEmailForLogin = vi.fn(async (_e: string): Promise<LoginUser | null> =>
    overrides.user === undefined ? USER : overrides.user,
  );
  const createRefreshToken = vi.fn(async (_u: string, _h: string, _e: Date) => {});
  const rotateRefreshToken = vi.fn(
    async (_h: string, _n: Date, _nh: string, _ne: Date): Promise<RotateRefreshResult> =>
      overrides.rotate ?? { outcome: 'invalid' },
  );
  const revokeRefreshToken = vi.fn(async (_h: string, _n: Date) => {});
  const findSessionUser = vi.fn(async (_id: string) => ({
    userId: USER.id,
    orgId: USER.orgId,
    email: USER.email,
  }));
  const store = {
    findUserByEmailForLogin,
    findSessionUser,
    createRefreshToken,
    rotateRefreshToken,
    revokeRefreshToken,
  };

  const verifyPassword = vi.fn(async (_p: string, _h: string) => overrides.passwordOk ?? true);
  const sign = vi.fn(async (_c: { userId: string; orgId: string }) => 'access-jwt');
  const loginConsume = vi.fn((_k: string) => overrides.rateOk ?? true);

  const deps: AuthServiceDeps = {
    store,
    verifyPassword,
    dummyPasswordHash: '$argon2id$DUMMY',
    generateToken: () => ({ raw: 'RAW-REFRESH', tokenHash: 'HASH-REFRESH' }),
    hashToken: (raw: string) => `h:${raw}`,
    accessTokenService: { sign, verify: async () => null },
    loginRateLimiter: { consume: loginConsume },
    refreshTtlMs: 1000,
    now: () => new Date('2026-06-18T12:00:00Z'),
  };
  return { service: createAuthService(deps), findUserByEmailForLogin, createRefreshToken, rotateRefreshToken, revokeRefreshToken, verifyPassword, sign, loginConsume };
}

const credentials = { email: 'owner@example.com', password: 'a-strong-pass-9' };

describe('authService.login', () => {
  it('issues tokens on a verified user with the right password', async () => {
    const t = build();
    const res = await t.service.login(credentials);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.session).toEqual({ userId: USER.id, orgId: USER.orgId, email: USER.email });
    expect(res.refreshToken).toBe('RAW-REFRESH'); // raw returned to the cookie
    expect(t.sign).toHaveBeenCalledWith({ userId: USER.id, orgId: USER.orgId });
    expect(t.createRefreshToken).toHaveBeenCalledWith(USER.id, 'HASH-REFRESH', expect.any(Date));
  });

  it('blocks an unverified user (no tokens)', async () => {
    const t = build({ user: { ...USER, emailVerified: false }, passwordOk: true });
    const res = await t.service.login(credentials);
    expect(res).toEqual({ ok: false, reason: 'unverified' });
    expect(t.createRefreshToken).not.toHaveBeenCalled();
  });

  it('rejects a wrong password with invalid_credentials', async () => {
    const t = build({ passwordOk: false });
    const res = await t.service.login(credentials);
    expect(res).toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(t.verifyPassword).toHaveBeenCalledWith(credentials.password, USER.passwordHash);
  });

  it('runs verifyPassword against the dummy hash for an unknown email (timing guard)', async () => {
    const t = build({ user: null });
    const res = await t.service.login(credentials);
    expect(res).toEqual({ ok: false, reason: 'invalid_credentials' });
    expect(t.verifyPassword).toHaveBeenCalledWith(credentials.password, '$argon2id$DUMMY');
  });

  it('rate-limits without touching the store', async () => {
    const t = build({ rateOk: false });
    const res = await t.service.login(credentials);
    expect(res).toEqual({ ok: false, reason: 'rate_limited' });
    expect(t.findUserByEmailForLogin).not.toHaveBeenCalled();
  });
});

describe('authService.refresh', () => {
  it('rotates: new access + refresh on a live token', async () => {
    const t = build({
      rotate: { outcome: 'rotated', user: { id: USER.id, orgId: USER.orgId, email: USER.email } },
    });
    const res = await t.service.refresh('raw-old');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.refreshToken).toBe('RAW-REFRESH');
    expect(t.rotateRefreshToken).toHaveBeenCalledWith('h:raw-old', expect.any(Date), 'HASH-REFRESH', expect.any(Date));
  });

  it('rejects an invalid token', async () => {
    const t = build({ rotate: { outcome: 'invalid' } });
    expect(await t.service.refresh('raw')).toEqual({ ok: false });
  });

  it('rejects a reused (revoked) token', async () => {
    const t = build({ rotate: { outcome: 'reuse_detected', userId: USER.id } });
    expect(await t.service.refresh('raw')).toEqual({ ok: false });
  });
});

describe('authService.me', () => {
  it('resolves the session for a verified caller id', async () => {
    const t = build();
    expect(await t.service.me(USER.id)).toEqual({
      userId: USER.id,
      orgId: USER.orgId,
      email: USER.email,
    });
  });
});

describe('authService.logout', () => {
  it('revokes the presented refresh token', async () => {
    const t = build();
    await t.service.logout('raw-token');
    expect(t.revokeRefreshToken).toHaveBeenCalledWith('h:raw-token', expect.any(Date));
  });

  it('is idempotent with no token', async () => {
    const t = build();
    await expect(t.service.logout('')).resolves.toBeUndefined();
    expect(t.revokeRefreshToken).not.toHaveBeenCalled();
  });
});
