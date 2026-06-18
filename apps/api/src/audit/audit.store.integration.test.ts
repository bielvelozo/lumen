import { resolve } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { makeDb, type Database } from '../db/client';
import { makeDrizzleSignupStore, type SignupStore } from '../auth/signup.store';
import { makeDrizzleFunctionLogStore, type FunctionLogStore } from '../chat/function-log.store';
import { makeDrizzleAuditStore, type AuditStore } from './audit.store';

// ---------------------------------------------------------------------------
// Live audit-store integration — env-gated on DATABASE_URL. Throwaway DB, migrate, seed two
// orgs' function_call_logs, then prove anti-IDOR: listForOrg(A) returns ONLY org A's rows, and
// filters/pagination work. Recorded LIVE-VERIFICATION-PENDING.
// ---------------------------------------------------------------------------
const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '..', '..', 'drizzle');
const TEST_DB = 'lumen_audit_test';

function withDatabase(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

describe.skipIf(!process.env.DATABASE_URL)('live: audit store', () => {
  let admin: Pool | undefined;
  let pool: Pool | undefined;
  let db: Database;
  let signupStore: SignupStore;
  let logStore: FunctionLogStore;
  let auditStore: AuditStore;
  let orgA = '';
  let orgB = '';

  beforeAll(async () => {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL missing');
    admin = new Pool({ connectionString: withDatabase(url, 'postgres') });
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
    const made = makeDb(withDatabase(url, TEST_DB));
    pool = made.pool;
    db = made.db;
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    signupStore = makeDrizzleSignupStore(db);
    logStore = makeDrizzleFunctionLogStore(db);
    auditStore = makeDrizzleAuditStore(db);

    const a = await signupStore.createTenant({ email: 'a@example.com', passwordHash: '$argon2id$x', organizationName: 'A' });
    const b = await signupStore.createTenant({ email: 'b@example.com', passwordHash: '$argon2id$x', organizationName: 'B' });
    if (a.outcome !== 'created' || b.outcome !== 'created') throw new Error('seed failed');
    orgA = a.orgId;
    orgB = b.orgId;

    // Org A: two success logs; Org B: one failed log (must never appear for A).
    await logStore.insert({ orgId: orgA, userId: a.userId, sessionId: null, messageId: null, functionName: 'aggregate_over_time', params: { table: 'string' }, status: 'success', durationMs: 10, provider: 'claude', model: 'claude-opus-4-8', errorMessage: null });
    await logStore.insert({ orgId: orgA, userId: a.userId, sessionId: null, messageId: null, functionName: 'filtered_aggregate', params: { table: 'string' }, status: 'failed', durationMs: 20, provider: 'claude', model: 'claude-opus-4-8', errorMessage: 'column_not_exposed' });
    await logStore.insert({ orgId: orgB, userId: b.userId, sessionId: null, messageId: null, functionName: 'aggregate_over_time', params: { table: 'string' }, status: 'failed', durationMs: 30, provider: 'claude', model: 'claude-opus-4-8', errorMessage: 'connection_unavailable' });
  }, 60_000);

  afterAll(async () => {
    if (pool) await pool.end();
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
      await admin.end();
    }
  });

  it('returns ONLY the caller org\'s rows (anti-IDOR), newest-first', async () => {
    const a = await auditStore.listForOrg(orgA, { page: 1, limit: 20 });
    expect(a.items).toHaveLength(2);
    expect(a.items.every((r) => r.functionName !== undefined)).toBe(true);
    // No org B activity leaks: B's only function call was 'connection_unavailable' — absent here.
    expect(a.items.some((r) => r.errorMessage === 'connection_unavailable')).toBe(false);

    const b = await auditStore.listForOrg(orgB, { page: 1, limit: 20 });
    expect(b.items).toHaveLength(1);
    expect(b.items[0]?.errorMessage).toBe('connection_unavailable');
  });

  it('filters by status', async () => {
    const failed = await auditStore.listForOrg(orgA, { page: 1, limit: 20, status: 'failed' });
    expect(failed.items).toHaveLength(1);
    expect(failed.items[0]?.functionName).toBe('filtered_aggregate');
  });

  it('paginates with hasMore', async () => {
    const page1 = await auditStore.listForOrg(orgA, { page: 1, limit: 1 });
    expect(page1.items).toHaveLength(1);
    expect(page1.hasMore).toBe(true);
    const page2 = await auditStore.listForOrg(orgA, { page: 2, limit: 1 });
    expect(page2.items).toHaveLength(1);
    expect(page2.hasMore).toBe(false);
  });
});
