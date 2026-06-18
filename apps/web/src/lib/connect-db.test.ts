import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ConsentStatusResponse, DbConnectionState, ExposureResponse } from '@lumen/shared';
import { deriveStep } from './connect-db-queries';
import { acceptConsent, createConnection, saveExposure } from './connect-db';

const accepted: ConsentStatusResponse = { currentVersion: '1', acceptedVersion: '1', accepted: true };
const notAccepted: ConsentStatusResponse = { currentVersion: '1', acceptedVersion: null, accepted: false };
const noConn: DbConnectionState = { hasConnection: false, status: null, lastTestedAt: null, lastError: null, config: null };
const active: DbConnectionState = {
  hasConnection: true,
  status: 'active',
  lastTestedAt: 't',
  lastError: null,
  config: { host: 'h', port: 3306, databaseName: 'd', username: 'u', sslEnabled: true },
};
const emptyExposure: ExposureResponse = { tables: [], relationships: [] };
const someExposure: ExposureResponse = { tables: [{ name: 'orders', columns: [] }], relationships: [] };

describe('deriveStep', () => {
  it('routes to consent when not accepted', () => {
    expect(deriveStep(notAccepted, noConn, undefined)).toBe('consent');
  });
  it('routes to connect when accepted but no active connection', () => {
    expect(deriveStep(accepted, noConn, undefined)).toBe('connect');
    expect(deriveStep(accepted, { ...active, status: 'failed' }, undefined)).toBe('connect');
    expect(deriveStep(accepted, { ...active, status: 'pending' }, undefined)).toBe('connect');
  });
  it('routes to exposure when active but nothing exposed', () => {
    expect(deriveStep(accepted, active, emptyExposure)).toBe('exposure');
    expect(deriveStep(accepted, active, undefined)).toBe('exposure');
  });
  it('routes to dashboard when active + exposure saved', () => {
    expect(deriveStep(accepted, active, someExposure)).toBe('dashboard');
  });
});

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async () => new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('anti-IDOR: no connect-db request carries an org_id', () => {
  it('accept / create / save-exposure send no org_id (and always credentials:include)', async () => {
    await acceptConsent('1');
    await createConnection({ host: 'h', port: 3306, databaseName: 'd', username: 'u', password: 'p', sslEnabled: true });
    await saveExposure({ tableNames: ['orders'], relationshipNames: [] });
    for (const call of fetchMock.mock.calls) {
      const url = String(call[0]);
      const init = (call[1] ?? {}) as RequestInit;
      const serialized = `${url} ${typeof init.body === 'string' ? init.body : ''}`;
      expect(serialized).not.toMatch(/org_id|orgId|dbConnectionId|connectionId/i);
      expect(init.credentials).toBe('include');
    }
  });
});
