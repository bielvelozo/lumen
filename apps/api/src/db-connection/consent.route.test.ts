import { describe, it, expect, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { CURRENT_CONSENT_VERSION, type ConsentStatusResponse } from '@lumen/shared';
import { buildApp } from '../app';
import { createAccessTokenService } from '../auth/jwt';
import { ACCESS_COOKIE } from '../auth/cookies';
import type { ConsentService, AcceptConsentResult } from './consent.service';

const SECRET = 'consent-route-test-secret-at-least-32b!';
const accessTokens = createAccessTokenService({ secret: SECRET, ttlSeconds: 900 });
const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = '11111111-1111-1111-1111-111111111111';

const STATUS: ConsentStatusResponse = {
  currentVersion: CURRENT_CONSENT_VERSION,
  acceptedVersion: CURRENT_CONSENT_VERSION,
  accepted: true,
};

function buildConsentApp(accept: AcceptConsentResult = { ok: true }) {
  const acceptConsent = vi.fn(async (_o: string, _u: string, _v: string) => accept);
  const service: ConsentService = {
    acceptConsent,
    getStatus: async () => STATUS,
    hasCurrentConsent: async () => true,
    getCurrentConsentRecord: async () => ({
      version: CURRENT_CONSENT_VERSION,
      acceptedAt: new Date(),
      acceptedBy: USER,
    }),
  };
  const app = buildApp({ dbConnection: { consentService: service, accessTokenService: accessTokens } });
  return { app, acceptConsent };
}

async function authedCookie(): Promise<Record<string, string>> {
  const token = await accessTokens.sign({ userId: USER, orgId: ORG });
  return { [ACCESS_COOKIE]: token };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('consent routes — auth required', () => {
  it('401s without a valid auth cookie', async () => {
    ({ app } = buildConsentApp());
    expect((await app.inject({ method: 'GET', url: '/db-connection/consent' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'POST', url: '/db-connection/consent', payload: { consentVersion: '1' } }))
        .statusCode,
    ).toBe(401);
  });
});

describe('POST /db-connection/consent', () => {
  it('records consent for the org/user FROM THE JWT (body cannot carry an org_id)', async () => {
    const built = buildConsentApp();
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: '/db-connection/consent',
      cookies: await authedCookie(),
      payload: { consentVersion: CURRENT_CONSENT_VERSION },
    });
    expect(res.statusCode).toBe(200);
    // org/user came from the verified JWT, never the request body.
    expect(built.acceptConsent).toHaveBeenCalledWith(ORG, USER, CURRENT_CONSENT_VERSION);
  });

  it('rejects an unknown field (e.g. a client-supplied org_id) with 400', async () => {
    ({ app } = buildConsentApp());
    const res = await app.inject({
      method: 'POST',
      url: '/db-connection/consent',
      cookies: await authedCookie(),
      payload: { consentVersion: '1', orgId: 'attacker-org' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 409 when the accepted version is stale', async () => {
    ({ app } = buildConsentApp({ ok: false, reason: 'stale_version' }));
    const res = await app.inject({
      method: 'POST',
      url: '/db-connection/consent',
      cookies: await authedCookie(),
      payload: { consentVersion: '0' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().currentVersion).toBe(CURRENT_CONSENT_VERSION);
  });
});

describe('GET /db-connection/consent[/terms] + onboarding script', () => {
  it('returns the org consent status', async () => {
    ({ app } = buildConsentApp());
    const res = await app.inject({
      method: 'GET',
      url: '/db-connection/consent',
      cookies: await authedCookie(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(STATUS);
  });

  it('returns the versioned terms', async () => {
    ({ app } = buildConsentApp());
    const res = await app.inject({
      method: 'GET',
      url: '/db-connection/consent/terms',
      cookies: await authedCookie(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().version).toBe(CURRENT_CONSENT_VERSION);
    expect(res.json().points).toHaveLength(4);
  });

  it('returns a read-only onboarding script', async () => {
    ({ app } = buildConsentApp());
    const res = await app.inject({
      method: 'POST',
      url: '/db-connection/onboarding-script',
      cookies: await authedCookie(),
      payload: { databaseName: 'shop' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.engine).toBe('mysql');
    expect(body.script).toContain('GRANT SELECT ON `shop`.*');
    expect(body.script).not.toContain('ALL PRIVILEGES');
  });
});
