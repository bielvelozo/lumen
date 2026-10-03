import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import {
  userRoleEnum,
  connectionStatusEnum,
  messageRoleEnum,
  logStatusEnum,
  dbConnections,
  aiConnections,
  exposedTables,
  exposedRelationships,
  messages,
  functionCallLogs,
} from './schema';

// ---------------------------------------------------------------------------
// Always-on structural assertions — no database needed. These guard the 1:1 port
// against the kinds of drift that are invisible until production: a secret column
// silently becoming text, a denormalized org_id dropped, an FK delete action
// flipped, or the v1 single-connection unique index sneaking in.
// ---------------------------------------------------------------------------
describe('schema: enums match db/schema.sql', () => {
  it('preserves enum values and order', () => {
    expect(userRoleEnum.enumValues).toEqual(['owner', 'member']);
    expect(connectionStatusEnum.enumValues).toEqual(['pending', 'active', 'failed']);
    expect(messageRoleEnum.enumValues).toEqual(['user', 'assistant']);
    expect(logStatusEnum.enumValues).toEqual(['success', 'failed']);
  });
});

const columnByName = (table: Parameters<typeof getTableConfig>[0], name: string) =>
  getTableConfig(table).columns.find((c) => c.name === name);

describe('schema: secret columns are bytea NOT NULL (invariant 2)', () => {
  it('db_connections.encrypted_password', () => {
    const col = columnByName(dbConnections, 'encrypted_password');
    expect(col?.getSQLType()).toBe('bytea');
    expect(col?.notNull).toBe(true);
  });
  it('ai_connections.encrypted_api_key', () => {
    const col = columnByName(aiConnections, 'encrypted_api_key');
    expect(col?.getSQLType()).toBe('bytea');
    expect(col?.notNull).toBe(true);
  });
});

describe('schema: jsonb columns', () => {
  it('exposed_tables.columns is jsonb NOT NULL with a default', () => {
    const col = columnByName(exposedTables, 'columns');
    expect(col?.getSQLType()).toBe('jsonb');
    expect(col?.notNull).toBe(true);
    expect(col?.hasDefault).toBe(true);
  });
  it('function_call_logs.params is nullable jsonb', () => {
    const col = columnByName(functionCallLogs, 'params');
    expect(col?.getSQLType()).toBe('jsonb');
    expect(col?.notNull).toBe(false);
  });
});

describe('schema: denormalized org_id is NOT NULL (invariant 1)', () => {
  it.each([
    ['exposed_tables', exposedTables],
    ['exposed_relationships', exposedRelationships],
    ['messages', messages],
    ['function_call_logs', functionCallLogs],
  ] as const)('%s.org_id', (_name, table) => {
    const col = columnByName(table, 'org_id');
    expect(col?.notNull).toBe(true);
  });
});

describe('schema: FK delete actions match db/schema.sql', () => {
  const deleteActionByColumn = (table: Parameters<typeof getTableConfig>[0]) => {
    const map = new Map<string, string | undefined>();
    for (const fk of getTableConfig(table).foreignKeys) {
      const localColumn = fk.reference().columns[0]?.name;
      if (localColumn) map.set(localColumn, fk.onDelete);
    }
    return map;
  };

  it('function_call_logs: user/session/message are SET NULL, org is CASCADE', () => {
    const actions = deleteActionByColumn(functionCallLogs);
    expect(actions.get('user_id')).toBe('set null');
    expect(actions.get('session_id')).toBe('set null');
    expect(actions.get('message_id')).toBe('set null');
    expect(actions.get('org_id')).toBe('cascade');
  });

  it('db_connections.consent_accepted_by has the default delete action (NO ACTION)', () => {
    const actions = deleteActionByColumn(dbConnections);
    // NO ACTION surfaces as undefined or the literal 'no action'; what matters for
    // the port is that it is NEITHER cascade NOR set null.
    const consentAction = actions.get('consent_accepted_by') ?? 'no action';
    expect(consentAction).toBe('no action');
    expect(actions.get('org_id')).toBe('cascade');
  });
});

describe('schema: v1 single-connection uniqueness', () => {
  it('db_connections has the uq_dbconn_org unique on org_id (one connection per org — spec 08)', () => {
    const uniques = getTableConfig(dbConnections).uniqueConstraints;
    expect(uniques).toHaveLength(1);
    expect(uniques[0]?.columns.map((c) => c.name)).toEqual(['org_id']);
  });
  it('ai_connections has the uq_aiconn_org unique on org_id (one AI connection per org — spec 11)', () => {
    const uniques = getTableConfig(aiConnections).uniqueConstraints;
    expect(uniques).toHaveLength(1);
    expect(uniques[0]?.columns.map((c) => c.name)).toEqual(['org_id']);
  });
  it('exposed_tables keeps its composite unique', () => {
    expect(getTableConfig(exposedTables).uniqueConstraints).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Live migrate smoke — env-gated on DATABASE_URL. Skips when absent (CI without a
// DB), so `pnpm test` stays green offline. Run green at least once against local
// Docker Postgres (recorded LIVE-VERIFICATION-PENDING). Creates a throwaway
// database, applies the committed migration, asserts the structure, then drops it.
// ---------------------------------------------------------------------------
const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '..', '..', 'drizzle');
const TEST_DB = 'lumen_migrate_smoke';

function withDatabase(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

describe.skipIf(!process.env.DATABASE_URL)('live: migrate applies to a fresh Postgres', () => {
  it(
    'creates the 4 enums + 14 tables + the DESC index',
    async () => {
      const url = process.env.DATABASE_URL;
      if (!url) throw new Error('DATABASE_URL missing');

      const admin = new Pool({ connectionString: withDatabase(url, 'postgres') });
      let testPool: Pool | undefined;
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
        await admin.query(`CREATE DATABASE ${TEST_DB}`);

        testPool = new Pool({ connectionString: withDatabase(url, TEST_DB) });
        await migrate(drizzle(testPool), { migrationsFolder: MIGRATIONS_FOLDER });

        const enums = await testPool.query<{ typname: string }>(
          'SELECT typname FROM pg_type WHERE typname = ANY($1::text[])',
          [['user_role', 'connection_status', 'message_role', 'log_status']],
        );
        expect(enums.rows.map((r) => r.typname).sort()).toEqual(
          ['connection_status', 'log_status', 'message_role', 'user_role'].sort(),
        );

        const tables = await testPool.query<{ table_name: string }>(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'",
        );
        const tableNames = tables.rows.map((r) => r.table_name);
        for (const expected of [
          'organizations',
          'users',
          'email_verification_tokens',
          'refresh_tokens',
          'db_connections',
          'exposed_tables',
          'exposed_relationships',
          'ai_connections',
          'chat_sessions',
          'messages',
          'function_call_logs',
          'db_connection_consents', // spec 07 (Option B) — beyond the original 11
          'password_reset_tokens',
          'sales_mappings', // spec 17 — Home metrics
        ]) {
          expect(tableNames).toContain(expected);
        }
        expect(tableNames).toHaveLength(14);

        const idx = await testPool.query<{ indexdef: string }>(
          "SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_session_org_updated'",
        );
        expect(idx.rows[0]?.indexdef).toContain('DESC');

        const encryptedColumn = await testPool.query<{ data_type: string }>(
          "SELECT data_type FROM information_schema.columns WHERE table_name = 'db_connections' AND column_name = 'encrypted_password'",
        );
        expect(encryptedColumn.rows[0]?.data_type).toBe('bytea');
      } finally {
        if (testPool) await testPool.end();
        await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
        await admin.end();
      }
    },
    60_000,
  );
});
