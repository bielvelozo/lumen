import { createConnection } from 'mysql2/promise';
import type { ResolvedConnection } from './allow-list';

/** Connect/query budget. A wedged provider surfaces as a sanitized `query_failed`, not a hang. */
const CONNECT_TIMEOUT_MS = 5000;
/** Per-statement ceiling (MySQL 5.7.8+ `max_execution_time`, milliseconds) — bounds a scan. */
const STATEMENT_TIMEOUT_MS = 10_000;

export interface ReadOnlyQueryInput {
  connection: ResolvedConnection;
  sql: string;
  params: unknown[];
}

/**
 * Runs a built read-only `SELECT` against the customer's MySQL. Injected so the executor stays
 * pure/testable; the real adapter decrypts the read-only credential in-process (spec 02 — Postgres
 * never sees plaintext), opens a short-lived connection with a statement-timeout ceiling, runs the
 * parameterized query, and always closes the connection.
 */
export interface QueryRunner {
  run(input: ReadOnlyQueryInput): Promise<Record<string, unknown>[]>;
}

export function createMysql2QueryRunner(deps: { decrypt(blob: Buffer): string }): QueryRunner {
  return {
    async run({ connection, sql, params }): Promise<Record<string, unknown>[]> {
      const password = deps.decrypt(connection.encryptedPassword);
      let conn: Awaited<ReturnType<typeof createConnection>> | undefined;
      try {
        conn = await createConnection({
          host: connection.host,
          port: connection.port,
          user: connection.username,
          password,
          database: connection.databaseName,
          connectTimeout: CONNECT_TIMEOUT_MS,
          ssl: connection.sslEnabled ? { rejectUnauthorized: true } : undefined,
          // Never run multiple statements on one call, even if a bug produced a ';'.
          multipleStatements: false,
        });
        // Statement-timeout backstop (ignored gracefully on engines that lack the var).
        await conn
          .query(`SET SESSION max_execution_time = ${STATEMENT_TIMEOUT_MS}`)
          .catch(() => undefined);
        const [rows] = await conn.query({ sql, values: params, timeout: STATEMENT_TIMEOUT_MS });
        return rows as Record<string, unknown>[];
      } finally {
        if (conn) await conn.end();
      }
    },
  };
}
