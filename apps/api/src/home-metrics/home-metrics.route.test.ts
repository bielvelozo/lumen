import { describe, it, expect, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { HomeMetricsResponse, SalesMapping } from '@lumen/shared';
import { buildApp } from '../app';
import { createAccessTokenService } from '../auth/jwt';
import { ACCESS_COOKIE } from '../auth/cookies';
import type { HomeMetricsService, SaveMappingResult } from './home-metrics.service';

const SECRET = 'home-metrics-route-test-secret-32bytes!';
const accessTokens = createAccessTokenService({ secret: SECRET, ttlSeconds: 900 });
const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER = '11111111-1111-1111-1111-111111111111';
const MAPPING: SalesMapping = { table: 'pedidos', amountColumn: 'total', dateColumn: 'criado_em' };
const METRICS: HomeMetricsResponse = {
  status: 'ok',
  current: { month: '2026-08', total: '74323.10', orders: 53, averageTicket: '1402.322642' },
  previous: { month: '2026-07', total: '60098.00', orders: 46, averageTicket: '1306.478261' },
};

function buildHomeApp(saveResult: SaveMappingResult = { outcome: 'saved', mapping: MAPPING }) {
  const service: HomeMetricsService = {
    getMapping: vi.fn(async () => MAPPING),
    saveMapping: vi.fn(async () => saveResult),
    getMetrics: vi.fn(async () => METRICS),
  };
  const app = buildApp({ homeMetrics: { service, accessTokenService: accessTokens } });
  return { app, service };
}

async function cookieFor(orgId: string): Promise<Record<string, string>> {
  return { [ACCESS_COOKIE]: await accessTokens.sign({ userId: USER, orgId }) };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('home metrics routes', () => {
  it.each([
    ['GET', '/sales-mapping'],
    ['PUT', '/sales-mapping'],
    ['GET', '/home/metrics'],
  ] as const)('%s %s 401s without auth', async (method, url) => {
    ({ app } = buildHomeApp());
    expect((await app.inject({ method, url, payload: method === 'PUT' ? MAPPING : undefined })).statusCode).toBe(401);
  });

  it('GET /home/metrics returns the figures for the org in the JWT', async () => {
    const built = buildHomeApp();
    app = built.app;
    const res = await app.inject({ method: 'GET', url: `/home/metrics?orgId=${ORG_B}`, cookies: await cookieFor(ORG_A) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(METRICS);
    expect(built.service.getMetrics).toHaveBeenCalledWith(ORG_A);
  });

  it('GET /sales-mapping returns the saved mapping', async () => {
    const built = buildHomeApp();
    app = built.app;
    const res = await app.inject({ method: 'GET', url: '/sales-mapping', cookies: await cookieFor(ORG_A) });
    expect(res.json()).toEqual({ mapping: MAPPING });
    expect(built.service.getMapping).toHaveBeenCalledWith(ORG_A);
  });

  it('PUT /sales-mapping saves for the org in the JWT', async () => {
    const built = buildHomeApp();
    app = built.app;
    const res = await app.inject({ method: 'PUT', url: '/sales-mapping', payload: MAPPING, cookies: await cookieFor(ORG_A) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mapping: MAPPING });
    expect(built.service.saveMapping).toHaveBeenCalledWith(ORG_A, MAPPING);
  });

  it('PUT /sales-mapping rejects a smuggled orgId before the service', async () => {
    const built = buildHomeApp();
    app = built.app;
    const res = await app.inject({
      method: 'PUT',
      url: '/sales-mapping',
      payload: { ...MAPPING, orgId: ORG_B },
      cookies: await cookieFor(ORG_A),
    });
    expect(res.statusCode).toBe(400);
    expect(built.service.saveMapping).not.toHaveBeenCalled();
  });

  it('PUT /sales-mapping answers 422 with the guard code for a column that cannot be used', async () => {
    ({ app } = buildHomeApp({ outcome: 'invalid', code: 'type_mismatch' }));
    const res = await app.inject({ method: 'PUT', url: '/sales-mapping', payload: MAPPING, cookies: await cookieFor(ORG_A) });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'InvalidSalesMapping', code: 'type_mismatch' });
  });

  it('PUT /sales-mapping answers 404 without a connection', async () => {
    ({ app } = buildHomeApp({ outcome: 'no_connection' }));
    const res = await app.inject({ method: 'PUT', url: '/sales-mapping', payload: MAPPING, cookies: await cookieFor(ORG_A) });
    expect(res.statusCode).toBe(404);
  });
});
