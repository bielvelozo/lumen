import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app';

const ALLOWED = 'https://app.lumen.example';
const OTHER = 'https://evil.example';

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('cross-site CORS (spec 16)', () => {
  it('reflects an allow-listed origin WITH credentials, never `*`', async () => {
    app = buildApp({ cors: { origins: [ALLOWED] } });
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: { origin: ALLOWED, 'access-control-request-method': 'GET' },
    });
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does NOT reflect an off-list origin (browser blocks the cross-site call)', async () => {
    app = buildApp({ cors: { origins: [ALLOWED] } });
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: { origin: OTHER, 'access-control-request-method': 'GET' },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('supports a multi-origin allow-list (prod + staging)', async () => {
    const STAGING = 'https://staging.lumen.example';
    app = buildApp({ cors: { origins: [ALLOWED, STAGING] } });
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: { origin: STAGING, 'access-control-request-method': 'GET' },
    });
    expect(res.headers['access-control-allow-origin']).toBe(STAGING);
  });

  it('a non-CORS request (no Origin) still works — health is reachable', async () => {
    app = buildApp({ cors: { origins: [ALLOWED] } });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });
});
