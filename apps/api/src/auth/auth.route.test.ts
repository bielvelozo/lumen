import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { SessionResponse } from '@lumen/shared';
import { buildApp } from '../app';
import { createAccessTokenService } from './jwt';
import type { AuthService, LoginResult, RefreshResult } from './auth.service';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './cookies';

const SECRET = 'auth-route-test-secret-at-least-32bytes!';
const accessTokens = createAccessTokenService({ secret: SECRET, ttlSeconds: 900 });
const SESSION: SessionResponse = {
  userId: '11111111-1111-1111-1111-111111111111',
  orgId: '22222222-2222-2222-2222-222222222222',
  email: 'owner@example.com',
};

interface FakeOpts {
  login?: LoginResult;
  refresh?: RefreshResult;
  me?: SessionResponse | null;
  onLogout?: () => void;
}

async function buildAuthApp(opts: FakeOpts = {}): Promise<FastifyInstance> {
  const accessToken = await accessTokens.sign({ userId: SESSION.userId, orgId: SESSION.orgId });
  const authService: AuthService = {
    async login() {
      return opts.login ?? { ok: true, session: SESSION, accessToken, refreshToken: 'RAW-REFRESH' };
    },
    async refresh() {
      return opts.refresh ?? { ok: true, session: SESSION, accessToken, refreshToken: 'RAW-REFRESH-2' };
    },
    async logout() {
      opts.onLogout?.();
    },
    async me() {
      return opts.me === undefined ? SESSION : opts.me;
    },
  };
  const app = buildApp({
    auth: { authService, accessTokenService: accessTokens, accessTtlSeconds: 900, refreshTtlSeconds: 1000 },
  });
  await app.ready();
  return app;
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

const creds = { email: 'owner@example.com', password: 'a-strong-pass-9' };

describe('POST /auth/login', () => {
  it('sets both cookies and returns the session (no token material in the body)', async () => {
    app = await buildAuthApp();
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: creds });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(SESSION);
    const names = res.cookies.map((c) => c.name);
    expect(names).toContain(ACCESS_COOKIE);
    expect(names).toContain(REFRESH_COOKIE);
    // The raw refresh token is only in the cookie, never echoed in the body.
    expect(res.payload).not.toContain('RAW-REFRESH');
  });

  it('401 on invalid credentials, 403 on unverified, 429 on rate limit', async () => {
    app = await buildAuthApp({ login: { ok: false, reason: 'invalid_credentials' } });
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: creds })).statusCode).toBe(401);
    await app.close();
    app = await buildAuthApp({ login: { ok: false, reason: 'unverified' } });
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: creds })).statusCode).toBe(403);
    await app.close();
    app = await buildAuthApp({ login: { ok: false, reason: 'rate_limited' } });
    expect((await app.inject({ method: 'POST', url: '/auth/login', payload: creds })).statusCode).toBe(429);
  });

  it('400 on a malformed body', async () => {
    app = await buildAuthApp();
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'nope' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /auth/me', () => {
  it('200 with a valid access cookie', async () => {
    app = await buildAuthApp();
    const token = await accessTokens.sign({ userId: SESSION.userId, orgId: SESSION.orgId });
    const res = await app.inject({ method: 'GET', url: '/auth/me', cookies: { [ACCESS_COOKIE]: token } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(SESSION);
  });

  it('401 without a cookie', async () => {
    app = await buildAuthApp();
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
  });
});

describe('POST /auth/refresh', () => {
  it('rotates cookies on a valid refresh token', async () => {
    app = await buildAuthApp();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { [REFRESH_COOKIE]: 'old-refresh' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.map((c) => c.name)).toContain(REFRESH_COOKIE);
  });

  it('401 + clears cookies on an invalid/replayed refresh token', async () => {
    app = await buildAuthApp({ refresh: { ok: false } });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { [REFRESH_COOKIE]: 'revoked' },
    });
    expect(res.statusCode).toBe(401);
    // Cleared cookies are present with empty values.
    const cleared = Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
    expect(cleared[REFRESH_COOKIE]).toBe('');
  });
});

describe('POST /auth/logout', () => {
  it('revokes + clears cookies and is idempotent', async () => {
    let calls = 0;
    app = await buildAuthApp({ onLogout: () => (calls += 1) });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { [REFRESH_COOKIE]: 'some-refresh' },
    });
    expect(res.statusCode).toBe(200);
    const cleared = Object.fromEntries(res.cookies.map((c) => [c.name, c.value]));
    expect(cleared[ACCESS_COOKIE]).toBe('');
    expect(cleared[REFRESH_COOKIE]).toBe('');

    // Calling again with no cookie still 200s (idempotent).
    const res2 = await app.inject({ method: 'POST', url: '/auth/logout' });
    expect(res2.statusCode).toBe(200);
    expect(calls).toBeGreaterThanOrEqual(1);
  });
});
