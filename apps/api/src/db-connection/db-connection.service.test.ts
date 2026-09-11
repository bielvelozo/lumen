import { describe, it, expect, vi } from 'vitest';
import type { DbConnectionConfig } from '@lumen/shared';
import { createDbConnectionService, type DbConnectionServiceDeps } from './db-connection.service';
import type { ConnectionTestResult, ConnectionTestInput } from './connection-tester';
import type { StoredConnection, UpsertConnectionInput } from './db-connection.store';
import type { ConsentRecord } from './consent.store';

const CONFIG: DbConnectionConfig = {
  host: 'db.example.com',
  port: 3306,
  databaseName: 'shop',
  username: 'lumen_ro',
  password: 'plaintext-pw',
  sslEnabled: false,
};

const CONSENT: ConsentRecord = {
  version: '1',
  acceptedAt: new Date('2026-06-18T00:00:00Z'),
  acceptedBy: 'user-1',
};

function build(opts: {
  testResult?: ConnectionTestResult;
  consent?: ConsentRecord | null;
  stored?: StoredConnection | null;
  decryptThrows?: boolean;
} = {}) {
  const upsert = vi.fn(async (_i: UpsertConnectionInput) => {});
  const updateStatus = vi.fn(async () => {});
  const getByOrg = vi.fn(async (_o: string): Promise<StoredConnection | null> => opts.stored ?? null);
  const getState = vi.fn(async () => null);
  const test = vi.fn(
    async (_input: ConnectionTestInput): Promise<ConnectionTestResult> => opts.testResult ?? { outcome: 'ok' },
  );
  const getCurrentConsentRecord = vi.fn(
    async (_o: string): Promise<ConsentRecord | null> => (opts.consent === undefined ? CONSENT : opts.consent),
  );

  const deps: DbConnectionServiceDeps = {
    store: { upsert, getByOrg, updateStatus, getState },
    tester: { test },
    consentService: {
      acceptConsent: vi.fn(),
      getStatus: vi.fn(),
      hasCurrentConsent: vi.fn(),
      getCurrentConsentRecord,
    },
    encrypt: (plain: string) => Buffer.from(`enc:${plain}`),
    decrypt: (blob: Buffer) => {
      if (opts.decryptThrows) throw new Error('MALFORMED_BLOB');
      return blob.toString('utf8');
    },
    now: () => new Date('2026-06-18T12:00:00Z'),
  };
  return { service: createDbConnectionService(deps), upsert, updateStatus, getByOrg, test };
}

describe('dbConnectionService.createOrUpdate', () => {
  it('happy path: tests, encrypts the password, persists active', async () => {
    const t = build({ testResult: { outcome: 'ok' } });
    const result = await t.service.createOrUpdate('org-1', CONFIG);
    expect(result).toEqual({
      outcome: 'saved',
      state: {
        hasConnection: true,
        status: 'active',
        lastTestedAt: '2026-06-18T12:00:00.000Z',
        lastError: null,
        config: { host: 'db.example.com', port: 3306, databaseName: 'shop', username: 'lumen_ro', sslEnabled: false },
      },
    });
    const upserted = t.upsert.mock.calls[0]?.[0] as UpsertConnectionInput;
    expect(upserted.orgId).toBe('org-1');
    expect(upserted.status).toBe('active');
    expect(upserted.encryptedPassword.toString('utf8')).toBe('enc:plaintext-pw'); // encrypted, not raw
    expect(upserted.consentVersion).toBe('1');
    expect(upserted.consentAcceptedBy).toBe('user-1');
  });

  it('a connection failure persists the row as failed with a sanitized category', async () => {
    const t = build({ testResult: { outcome: 'failed', category: 'auth_failed' } });
    const result = await t.service.createOrUpdate('org-1', CONFIG);
    expect(result.outcome).toBe('saved');
    if (result.outcome === 'saved') {
      expect(result.state.status).toBe('failed');
      expect(result.state.lastError).toBe('auth_failed');
    }
    expect(t.upsert).toHaveBeenCalledTimes(1); // config + credential saved for re-test
  });

  it('REJECTS an over-privileged/root credential and stores NOTHING (invariant 5)', async () => {
    const t = build({ testResult: { outcome: 'over_privileged' } });
    const result = await t.service.createOrUpdate('org-1', CONFIG);
    expect(result).toEqual({ outcome: 'over_privileged' });
    expect(t.upsert).not.toHaveBeenCalled(); // never store an over-privileged credential
  });

  it('blocks when there is no current-version consent (and never connects)', async () => {
    const t = build({ consent: null });
    const result = await t.service.createOrUpdate('org-1', CONFIG);
    expect(result).toEqual({ outcome: 'no_consent' });
    expect(t.test).not.toHaveBeenCalled();
    expect(t.upsert).not.toHaveBeenCalled();
  });

  it('never returns the password in the result state', async () => {
    const result = await build({ testResult: { outcome: 'ok' } }).service.createOrUpdate('o', CONFIG);
    expect(JSON.stringify(result)).not.toContain('plaintext-pw');
  });
});

describe('dbConnectionService.retest', () => {
  const stored: StoredConnection = {
    id: 'conn-1',
    host: 'h',
    port: 3306,
    databaseName: 'd',
    username: 'u',
    sslEnabled: false,
    encryptedPassword: Buffer.from('stored-pw'),
    status: 'failed',
  };

  it('decrypts the stored password and re-tests without re-entry', async () => {
    const t = build({ stored, testResult: { outcome: 'ok' } });
    const result = await t.service.retest('org-1');
    expect(result.outcome).toBe('tested');
    if (result.outcome === 'tested') expect(result.state.status).toBe('active');
    // tester received the decrypted stored password.
    expect(t.test.mock.calls[0]?.[0]?.password).toBe('stored-pw');
    expect(t.updateStatus).toHaveBeenCalled();
  });

  it('404s when there is no saved connection', async () => {
    const t = build({ stored: null });
    expect(await t.service.retest('org-1')).toEqual({ outcome: 'not_found' });
  });

  it('reports a stored password it can no longer decrypt as a failed connection, not a crash', async () => {
    const t = build({ stored, decryptThrows: true });
    const result = await t.service.retest('org-1');

    expect(result.outcome).toBe('tested');
    if (result.outcome === 'tested') {
      expect(result.state.status).toBe('failed');
      expect(result.state.lastError).toBe('auth_failed');
    }
    expect(t.test).not.toHaveBeenCalled(); // never dialed with an unusable credential
    expect(t.updateStatus).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ status: 'failed', lastError: 'auth_failed' }),
    );
  });
});
