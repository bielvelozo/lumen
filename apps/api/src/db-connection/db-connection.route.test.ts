import { describe, it, expect, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DbConnectionConfig, DbConnectionState } from '@lumen/shared';
import { buildApp } from '../app';
import { createAccessTokenService } from '../auth/jwt';
import { ACCESS_COOKIE } from '../auth/cookies';
import type { ConsentService } from './consent.service';
import type { DbConnectionService, CreateOrUpdateResult, RetestResult } from './db-connection.service';

const SECRET = 'dbconn-route-test-secret-at-least-32b!';
const accessTokens = createAccessTokenService({ secret: SECRET, ttlSeconds: 900 });
const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = '11111111-1111-1111-1111-111111111111';

const ACTIVE_STATE: DbConnectionState = {
  hasConnection: true,
  status: 'active',
  lastTestedAt: '2026-06-18T12:00:00.000Z',
  lastError: null,
};

const VALID_BODY: DbConnectionConfig = {
  host: 'db.example.com',
  port: 3306,
  databaseName: 'shop',
  username: 'lumen_ro',
  password: 'plaintext-pw',
  sslEnabled: false,
};

function buildDbConnApp(opts: { create?: CreateOrUpdateResult; retest?: RetestResult } = {}) {
  const createOrUpdate = vi.fn(async (_o: string, _c: DbConnectionConfig): Promise<CreateOrUpdateResult> =>
    opts.create ?? { outcome: 'saved', state: ACTIVE_STATE },
  );
  const service: DbConnectionService = {
    createOrUpdate,
    retest: async () => opts.retest ?? { outcome: 'tested', state: ACTIVE_STATE },
    getState: async () => ({ hasConnection: false, status: null, lastTestedAt: null, lastError: null }),
  };
  const consentService = {
    acceptConsent: vi.fn(),
    getStatus: vi.fn(),
    hasCurrentConsent: vi.fn(),
    getCurrentConsentRecord: vi.fn(),
  } as unknown as ConsentService;
  const app = buildApp({
    dbConnection: { consentService, dbConnectionService: service, accessTokenService: accessTokens },
  });
  return { app, createOrUpdate };
}

async function cookie(): Promise<Record<string, string>> {
  return { [ACCESS_COOKIE]: await accessTokens.sign({ userId: USER, orgId: ORG }) };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('PUT /db-connection', () => {
  it('401s without auth', async () => {
    ({ app } = buildDbConnApp());
    expect((await app.inject({ method: 'PUT', url: '/db-connection', payload: VALID_BODY })).statusCode).toBe(401);
  });

  it('200 on success and resolves the org from the JWT (not the body)', async () => {
    const built = buildDbConnApp();
    app = built.app;
    const res = await app.inject({ method: 'PUT', url: '/db-connection', cookies: await cookie(), payload: VALID_BODY });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(ACTIVE_STATE);
    expect(built.createOrUpdate.mock.calls[0]?.[0]).toBe(ORG); // org from JWT
    expect(res.payload).not.toContain('plaintext-pw'); // password never echoed
  });

  it('rejects an unknown field like org_id (.strict) with 400', async () => {
    ({ app } = buildDbConnApp());
    const res = await app.inject({
      method: 'PUT',
      url: '/db-connection',
      cookies: await cookie(),
      payload: { ...VALID_BODY, orgId: 'attacker-org' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('403 when consent is missing', async () => {
    ({ app } = buildDbConnApp({ create: { outcome: 'no_consent' } }));
    const res = await app.inject({ method: 'PUT', url: '/db-connection', cookies: await cookie(), payload: VALID_BODY });
    expect(res.statusCode).toBe(403);
  });

  it('422 when the credential is over-privileged (rejected, not stored)', async () => {
    ({ app } = buildDbConnApp({ create: { outcome: 'over_privileged' } }));
    const res = await app.inject({ method: 'PUT', url: '/db-connection', cookies: await cookie(), payload: VALID_BODY });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('CredentialOverPrivileged');
  });
});

describe('POST /db-connection/test + GET /db-connection', () => {
  it('re-tests an existing connection (200) and 404s when none', async () => {
    ({ app } = buildDbConnApp());
    expect((await app.inject({ method: 'POST', url: '/db-connection/test', cookies: await cookie() })).statusCode).toBe(200);
    await app.close();
    ({ app } = buildDbConnApp({ retest: { outcome: 'not_found' } }));
    expect((await app.inject({ method: 'POST', url: '/db-connection/test', cookies: await cookie() })).statusCode).toBe(404);
  });

  it('returns the public state (no connection)', async () => {
    ({ app } = buildDbConnApp());
    const res = await app.inject({ method: 'GET', url: '/db-connection', cookies: await cookie() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hasConnection: false, status: null, lastTestedAt: null, lastError: null });
  });
});
