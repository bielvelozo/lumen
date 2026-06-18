import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { setAuthCookies, clearAuthCookies, ACCESS_COOKIE, REFRESH_COOKIE } from './cookies';

function buildCookieApp(): FastifyInstance {
  const app = Fastify();
  app.register(cookie);
  app.post('/set', async (_req, reply) => {
    setAuthCookies(reply, {
      accessToken: 'ACCESS',
      accessMaxAgeSeconds: 900,
      refreshToken: 'REFRESH',
      refreshMaxAgeSeconds: 1000,
    });
    return reply.send({ ok: true });
  });
  app.post('/clear', async (_req, reply) => {
    clearAuthCookies(reply);
    return reply.send({ ok: true });
  });
  return app;
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('auth cookies', () => {
  it('sets both cookies httpOnly + Secure + SameSite=None with the right paths', async () => {
    app = buildCookieApp();
    const res = await app.inject({ method: 'POST', url: '/set' });
    const byName = Object.fromEntries(res.cookies.map((c) => [c.name, c]));

    const access = byName[ACCESS_COOKIE];
    const refresh = byName[REFRESH_COOKIE];
    expect(access).toBeDefined();
    expect(refresh).toBeDefined();

    for (const c of [access, refresh]) {
      expect(c?.httpOnly).toBe(true);
      expect(c?.secure).toBe(true);
      expect(String(c?.sameSite).toLowerCase()).toBe('none');
    }
    expect(access?.value).toBe('ACCESS');
    expect(access?.path).toBe('/');
    expect(refresh?.value).toBe('REFRESH');
    expect(refresh?.path).toBe('/auth'); // least surface
  });

  it('clears both cookies (past expiry / empty value)', async () => {
    app = buildCookieApp();
    const res = await app.inject({ method: 'POST', url: '/clear' });
    const byName = Object.fromEntries(res.cookies.map((c) => [c.name, c]));
    const access = byName[ACCESS_COOKIE];
    const refresh = byName[REFRESH_COOKIE];
    expect(access).toBeDefined();
    expect(refresh).toBeDefined();
    // A cleared cookie has an empty value and an expiry at/around the epoch.
    expect(access?.value).toBe('');
    expect(refresh?.value).toBe('');
    expect(access?.expires?.getTime() ?? 0).toBeLessThan(Date.now());
    expect(refresh?.expires?.getTime() ?? 0).toBeLessThan(Date.now());
  });
});
