import { describe, it, expect, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AuditLogDTO, AuditQuery } from '@lumen/shared';
import { buildApp } from '../app';
import { createAccessTokenService } from '../auth/jwt';
import { ACCESS_COOKIE } from '../auth/cookies';
import type { AuditStore } from './audit.store';

const SECRET = 'audit-route-test-secret-at-least-32bytes';
const accessTokens = createAccessTokenService({ secret: SECRET, ttlSeconds: 900 });
const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER = '11111111-1111-1111-1111-111111111111';

const ROW_A: AuditLogDTO = {
  id: 'log-a',
  functionName: 'aggregate_over_time',
  status: 'success',
  durationMs: 12,
  provider: 'claude',
  model: 'claude-opus-4-8',
  params: { table: 'string' },
  errorMessage: null,
  createdAt: '2026-06-18T12:00:00.000Z',
};

function buildAuditApp() {
  // The store is the anti-IDOR boundary: it only ever returns rows for the orgId it is GIVEN.
  const listForOrg = vi.fn(async (orgId: string, _q: AuditQuery) =>
    orgId === ORG_A ? { items: [ROW_A], hasMore: false } : { items: [], hasMore: false },
  );
  const store: AuditStore = { listForOrg };
  const app = buildApp({ audit: { auditStore: store, accessTokenService: accessTokens } });
  return { app, listForOrg };
}

async function cookieFor(orgId: string): Promise<Record<string, string>> {
  return { [ACCESS_COOKIE]: await accessTokens.sign({ userId: USER, orgId }) };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('GET /audit/function-calls', () => {
  it('401s without auth', async () => {
    ({ app } = buildAuditApp());
    expect((await app.inject({ method: 'GET', url: '/audit/function-calls' })).statusCode).toBe(401);
  });

  it('returns the caller\'s org rows, resolving org from the JWT', async () => {
    const built = buildAuditApp();
    app = built.app;
    const res = await app.inject({ method: 'GET', url: '/audit/function-calls', cookies: await cookieFor(ORG_A) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [ROW_A], page: 1, hasMore: false });
    expect(built.listForOrg.mock.calls[0]?.[0]).toBe(ORG_A); // org from JWT
  });

  it('anti-IDOR: a forged org_id in the query is ignored — the JWT org wins (returns no foreign rows)', async () => {
    const built = buildAuditApp();
    app = built.app;
    // Caller is ORG_B; they try to read ORG_A's logs via a query param.
    const res = await app.inject({
      method: 'GET',
      url: `/audit/function-calls?orgId=${ORG_A}`,
      cookies: await cookieFor(ORG_B),
    });
    // .strict() rejects the unknown `orgId` query field outright (never reaches the store with it).
    expect(res.statusCode).toBe(400);
    // And even a clean request as ORG_B gets only ORG_B rows (none here).
    const clean = await app.inject({ method: 'GET', url: '/audit/function-calls', cookies: await cookieFor(ORG_B) });
    expect(clean.json()).toEqual({ items: [], page: 1, hasMore: false });
    expect(built.listForOrg.mock.calls.every((c) => c[0] === ORG_B)).toBe(true);
  });

  it('passes through status/function filters', async () => {
    const built = buildAuditApp();
    app = built.app;
    await app.inject({
      method: 'GET',
      url: '/audit/function-calls?status=failed&functionName=filtered_aggregate&page=2&limit=5',
      cookies: await cookieFor(ORG_A),
    });
    expect(built.listForOrg.mock.calls[0]?.[1]).toMatchObject({
      status: 'failed',
      functionName: 'filtered_aggregate',
      page: 2,
      limit: 5,
    });
  });
});
