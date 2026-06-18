import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createConnection, type Connection } from 'mysql2/promise';
import { createMysqlConnectionTester } from './connection-tester';

// ---------------------------------------------------------------------------
// Live MySQL integration — env-gated on MYSQL_URL. Skips when absent. This is the
// MANDATORY live-DB test for spec 08 (RALPH 7(2): 01/08/09/13 must run live once). Using
// root, it provisions a throwaway DB + a SELECT-only user, then drives the REAL tester:
// read-only -> ok, root -> over_privileged, wrong-password -> auth_failed, bad-db ->
// database_not_found. Cleans up after. Recorded LIVE-VERIFICATION-PENDING.
// ---------------------------------------------------------------------------
const TEST_DB = 'lumen_conn_test';
const RO_USER = 'lumen_ro_test';
const RO_PASS = 'ro_pw_strong';

function rootConfig(): { host: string; port: number; user: string; password: string } {
  const url = new URL(process.env.MYSQL_URL ?? '');
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

describe.skipIf(!process.env.MYSQL_URL)('live: MySQL connection tester', () => {
  const tester = createMysqlConnectionTester();
  let root: ReturnType<typeof rootConfig>;
  let admin: Connection | undefined;

  beforeAll(async () => {
    // Parse here (not in the describe body): vitest still evaluates a skipped describe's
    // body during collection, where `new URL('')` would throw with MYSQL_URL absent.
    root = rootConfig();
    admin = await createConnection({ ...root, connectTimeout: 5000, multipleStatements: true });
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${TEST_DB}\``);
    await admin.query(`DROP USER IF EXISTS '${RO_USER}'@'%'`);
    // mysql_native_password keeps the read-only user connectable over plaintext (no RSA
    // key exchange), which is all this test needs.
    await admin.query(
      `CREATE USER '${RO_USER}'@'%' IDENTIFIED WITH mysql_native_password BY '${RO_PASS}'`,
    );
    await admin.query(`GRANT SELECT ON \`${TEST_DB}\`.* TO '${RO_USER}'@'%'`);
    await admin.query('FLUSH PRIVILEGES');
  }, 30_000);

  afterAll(async () => {
    if (admin) {
      await admin.query(`DROP USER IF EXISTS '${RO_USER}'@'%'`);
      await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
      await admin.end();
    }
  });

  it('a SELECT-only user connects and is accepted (active)', async () => {
    const result = await tester.test({
      host: root.host,
      port: root.port,
      database: TEST_DB,
      username: RO_USER,
      password: RO_PASS,
      ssl: false,
    });
    expect(result).toEqual({ outcome: 'ok' });
  });

  it('the root credential is detected as over-privileged (rejected)', async () => {
    const result = await tester.test({
      host: root.host,
      port: root.port,
      database: TEST_DB,
      username: root.user,
      password: root.password,
      ssl: false,
    });
    expect(result).toEqual({ outcome: 'over_privileged' });
  });

  it('a wrong password fails as auth_failed (raw error never surfaced)', async () => {
    const result = await tester.test({
      host: root.host,
      port: root.port,
      database: TEST_DB,
      username: RO_USER,
      password: 'definitely-wrong',
      ssl: false,
    });
    expect(result).toEqual({ outcome: 'failed', category: 'auth_failed' });
  });

  it('a non-existent database fails as database_not_found (privileged user → ER_BAD_DB_ERROR)', async () => {
    // A user WITH server access hitting a missing db gets ER_BAD_DB_ERROR (1049). A
    // restricted user instead gets access_denied (1044) — MySQL avoids leaking existence —
    // which is also a valid `failed`; here we assert the clean database_not_found mapping.
    const result = await tester.test({
      host: root.host,
      port: root.port,
      database: 'no_such_db_xyz',
      username: root.user,
      password: root.password,
      ssl: false,
    });
    expect(result).toEqual({ outcome: 'failed', category: 'database_not_found' });
  });

  it('an unreachable port fails fast (connection_refused/timeout, not a hang)', async () => {
    const result = await tester.test({
      host: root.host,
      port: 59999, // nothing listening
      database: TEST_DB,
      username: RO_USER,
      password: RO_PASS,
      ssl: false,
    });
    expect(result.outcome).toBe('failed');
    if (result.outcome === 'failed') {
      expect(['connection_refused', 'timeout', 'host_unreachable']).toContain(result.category);
    }
  });
});
