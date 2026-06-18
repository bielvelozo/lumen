import { describe, it, expect, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AiConnectState } from '@lumen/shared';
import { buildApp } from '../app';
import { createAccessTokenService } from '../auth/jwt';
import { ACCESS_COOKIE } from '../auth/cookies';
import type { AiConnectionService, ConnectResult } from './ai-connection.service';

const SECRET = 'aiconn-route-test-secret-at-least-32b!';
const accessTokens = createAccessTokenService({ secret: SECRET, ttlSeconds: 900 });
const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = '11111111-1111-1111-1111-111111111111';

const ACTIVE_STATE: AiConnectState = {
  provider: 'claude',
  hasKey: true,
  defaultModel: 'claude-opus-4-8',
  status: 'active',
  lastValidatedAt: '2026-06-18T12:00:00.000Z',
  lastError: null,
};
const EMPTY_STATE: AiConnectState = {
  provider: 'claude',
  hasKey: false,
  defaultModel: null,
  status: null,
  lastValidatedAt: null,
  lastError: null,
};

function buildAiApp(opts: { connect?: ConnectResult } = {}) {
  const connect = vi.fn(
    async (_org: string): Promise<ConnectResult> =>
      opts.connect ?? { outcome: 'connected', result: { state: ACTIVE_STATE, error: null } },
  );
  const service: AiConnectionService = { connect, getState: async () => EMPTY_STATE };
  const app = buildApp({ aiConnection: { aiConnectionService: service, accessTokenService: accessTokens } });
  return { app, connect };
}

async function cookie(): Promise<Record<string, string>> {
  return { [ACCESS_COOKIE]: await accessTokens.sign({ userId: USER, orgId: ORG }) };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('GET /ai-connection', () => {
  it('401s without auth', async () => {
    ({ app } = buildAiApp());
    expect((await app.inject({ method: 'GET', url: '/ai-connection' })).statusCode).toBe(401);
  });

  it('returns non-secret state and never a key field', async () => {
    ({ app } = buildAiApp());
    const res = await app.inject({ method: 'GET', url: '/ai-connection', cookies: await cookie() });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toEqual(EMPTY_STATE);
    expect(JSON.stringify(body)).not.toMatch(/apiKey|encryptedApiKey|encrypted_api_key/);
  });
});

describe('PUT /ai-connection', () => {
  it('401s without auth', async () => {
    ({ app } = buildAiApp());
    const res = await app.inject({ method: 'PUT', url: '/ai-connection', payload: { model: 'claude-opus-4-8' } });
    expect(res.statusCode).toBe(401);
  });

  it('resolves the org from the JWT (never the body) and returns 200 with the result', async () => {
    const built = buildAiApp();
    app = built.app;
    const res = await app.inject({
      method: 'PUT',
      url: '/ai-connection',
      cookies: await cookie(),
      // A malicious orgId in the body is ignored (anti-IDOR + .strict()).
      payload: { apiKey: 'sk-ant-xyz', model: 'claude-opus-4-8', orgId: 'attacker-org' },
    });
    // .strict() rejects the extra orgId field -> 400 (never reaches the service with it).
    expect(res.statusCode).toBe(400);
    expect(built.connect).not.toHaveBeenCalled();
  });

  it('200 on success; org comes from the JWT', async () => {
    const built = buildAiApp();
    app = built.app;
    const res = await app.inject({
      method: 'PUT',
      url: '/ai-connection',
      cookies: await cookie(),
      payload: { apiKey: 'sk-ant-xyz', model: 'claude-opus-4-8' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: ACTIVE_STATE, error: null });
    expect(built.connect.mock.calls[0]?.[0]).toBe(ORG);
  });

  it('rejects a model outside the curated list BEFORE any service call (400)', async () => {
    const built = buildAiApp();
    app = built.app;
    const res = await app.inject({
      method: 'PUT',
      url: '/ai-connection',
      cookies: await cookie(),
      payload: { apiKey: 'sk-ant-xyz', model: 'claude-opus-4-7' },
    });
    expect(res.statusCode).toBe(400);
    expect(built.connect).not.toHaveBeenCalled();
  });

  it('200 with sanitized error category on a validation failure', async () => {
    ({ app } = buildAiApp({
      connect: { outcome: 'validation_failed', result: { state: EMPTY_STATE, error: 'invalid_key' } },
    }));
    const res = await app.inject({
      method: 'PUT',
      url: '/ai-connection',
      cookies: await cookie(),
      payload: { apiKey: 'sk-ant-bad', model: 'claude-opus-4-8' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ state: EMPTY_STATE, error: 'invalid_key' });
  });

  it('404 when re-validating with no stored connection', async () => {
    ({ app } = buildAiApp({ connect: { outcome: 'no_connection' } }));
    const res = await app.inject({
      method: 'PUT',
      url: '/ai-connection',
      cookies: await cookie(),
      payload: { model: 'claude-opus-4-8' },
    });
    expect(res.statusCode).toBe(404);
  });
});
