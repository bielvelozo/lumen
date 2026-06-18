import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { createAccessTokenService } from './jwt';
import { makeRequireAuth, getAuth } from './require-auth';
import { ACCESS_COOKIE } from './cookies';

const SECRET = 'require-auth-test-secret-at-least-32b!!';
const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_A = '11111111-1111-1111-1111-111111111111';

const accessTokens = createAccessTokenService({ secret: SECRET, ttlSeconds: 900 });

function buildGuardedApp(): FastifyInstance {
  const app = Fastify();
  app.register(cookie);
  const requireAuth = makeRequireAuth(accessTokens);
  // A protected route that reflects the resolved tenant — ONLY from getAuth (the JWT).
  app.post('/whoami', { preHandler: requireAuth }, async (request) => {
    const { userId, orgId } = getAuth(request);
    return { userId, orgId };
  });
  return app;
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('requireAuth', () => {
  it('attaches { userId, orgId } from a valid JWT cookie', async () => {
    app = buildGuardedApp();
    const token = await accessTokens.sign({ userId: USER_A, orgId: ORG_A });
    const res = await app.inject({
      method: 'POST',
      url: '/whoami',
      cookies: { [ACCESS_COOKIE]: token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ userId: USER_A, orgId: ORG_A });
  });

  it('GUARD: orgId comes ONLY from the JWT — a body/query orgId is ignored', async () => {
    app = buildGuardedApp();
    const token = await accessTokens.sign({ userId: USER_A, orgId: ORG_A });
    const res = await app.inject({
      method: 'POST',
      url: `/whoami?orgId=${ORG_B}`,
      cookies: { [ACCESS_COOKIE]: token },
      payload: { orgId: ORG_B, userId: 'attacker' },
    });
    expect(res.statusCode).toBe(200);
    // The attacker-supplied ORG_B is nowhere in the response — only the JWT's ORG_A.
    expect(res.json()).toEqual({ userId: USER_A, orgId: ORG_A });
    expect(res.payload).not.toContain(ORG_B);
  });

  it('401s with no cookie', async () => {
    app = buildGuardedApp();
    const res = await app.inject({ method: 'POST', url: '/whoami' });
    expect(res.statusCode).toBe(401);
  });

  it('401s with an invalid/tampered cookie', async () => {
    app = buildGuardedApp();
    const res = await app.inject({
      method: 'POST',
      url: '/whoami',
      cookies: { [ACCESS_COOKIE]: 'not-a-jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('401s with a token signed by a different secret', async () => {
    app = buildGuardedApp();
    const foreign = createAccessTokenService({ secret: 'a-different-secret-at-least-32-bytes!!', ttlSeconds: 900 });
    const token = await foreign.sign({ userId: USER_A, orgId: ORG_A });
    const res = await app.inject({
      method: 'POST',
      url: '/whoami',
      cookies: { [ACCESS_COOKIE]: token },
    });
    expect(res.statusCode).toBe(401);
  });
});
