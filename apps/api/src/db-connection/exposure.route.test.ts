import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { IntrospectedSchema, ExposureResponse, SaveExposureRequest } from '@lumen/shared';
import { buildApp } from '../app';
import { createAccessTokenService } from '../auth/jwt';
import { ACCESS_COOKIE } from '../auth/cookies';
import type { ConsentService } from './consent.service';
import type { ExposureService, SaveExposureResult } from './exposure.service';

const SECRET = 'exposure-route-test-secret-at-least-32!';
const accessTokens = createAccessTokenService({ secret: SECRET, ttlSeconds: 900 });
const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = '11111111-1111-1111-1111-111111111111';

const SCHEMA: IntrospectedSchema = { tables: [{ name: 'products', columns: [] }], relationships: [] };
const EXPOSURE: ExposureResponse = { tables: [{ name: 'products', columns: [] }], relationships: [] };

function buildExposureApp(opts: { save?: SaveExposureResult } = {}) {
  const service: ExposureService = {
    introspect: async () => ({ outcome: 'ok', schema: SCHEMA }),
    getExposure: async () => ({ outcome: 'ok', exposure: EXPOSURE }),
    saveExposure: async (_o: string, _r: SaveExposureRequest) =>
      opts.save ?? { outcome: 'saved', exposure: EXPOSURE },
  };
  const consentService = {
    acceptConsent: async () => ({ ok: true as const }),
    getStatus: async () => ({ currentVersion: '1', acceptedVersion: '1', accepted: true }),
    hasCurrentConsent: async () => true,
    getCurrentConsentRecord: async () => null,
  } as unknown as ConsentService;
  return buildApp({
    dbConnection: { consentService, exposureService: service, accessTokenService: accessTokens },
  });
}

async function cookie(): Promise<Record<string, string>> {
  return { [ACCESS_COOKIE]: await accessTokens.sign({ userId: USER, orgId: ORG }) };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('introspection + exposure routes', () => {
  it('401s without auth', async () => {
    app = buildExposureApp();
    expect((await app.inject({ method: 'GET', url: '/db-connection/introspect' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/db-connection/exposure' })).statusCode).toBe(401);
  });

  it('GET /introspect returns the discovered schema', async () => {
    app = buildExposureApp();
    const res = await app.inject({ method: 'GET', url: '/db-connection/introspect', cookies: await cookie() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(SCHEMA);
  });

  it('GET /exposure returns the current allow-list', async () => {
    app = buildExposureApp();
    const res = await app.inject({ method: 'GET', url: '/db-connection/exposure', cookies: await cookie() });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(EXPOSURE);
  });

  it('PUT /exposure saves and returns the allow-list', async () => {
    app = buildExposureApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/db-connection/exposure',
      cookies: await cookie(),
      payload: { tableNames: ['products'], relationshipNames: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(EXPOSURE);
  });

  it('rejects a body that smuggles a connection id (.strict) with 400', async () => {
    app = buildExposureApp();
    const res = await app.inject({
      method: 'PUT',
      url: '/db-connection/exposure',
      cookies: await cookie(),
      payload: { tableNames: ['products'], relationshipNames: [], dbConnectionId: 'attacker' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('maps the same-connection invariant violation to 422', async () => {
    app = buildExposureApp({ save: { outcome: 'invariant_violation', name: 'orders__x__products' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/db-connection/exposure',
      cookies: await cookie(),
      payload: { tableNames: ['orders'], relationshipNames: ['orders__x__products'] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('RelationshipEndpointNotExposed');
  });

  it('maps a not-active connection to 409', async () => {
    app = buildExposureApp({ save: { outcome: 'not_active' } });
    const res = await app.inject({
      method: 'PUT',
      url: '/db-connection/exposure',
      cookies: await cookie(),
      payload: { tableNames: [], relationshipNames: [] },
    });
    expect(res.statusCode).toBe(409);
  });
});
