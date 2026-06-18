import { createConnection } from 'mysql2/promise';
import type { ConnectionErrorCategory } from '@lumen/shared';
import { mapMysqlError } from './mysql-errors';
import { analyzeGrants } from './grants';

/** Coordinates for a live test. `password` is plaintext, in-memory only — never logged. */
export interface ConnectionTestInput {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
}

/**
 * Result of a live connection test:
 * - `ok`: connected, `SELECT 1` succeeded, credential is read-only.
 * - `over_privileged`: connected, but `SHOW GRANTS` reveals write/admin/root — REJECT it.
 * - `failed`: could not connect / read; carries a SANITIZED category (never the raw error).
 */
export type ConnectionTestResult =
  | { outcome: 'ok' }
  | { outcome: 'over_privileged' }
  | { outcome: 'failed'; category: ConnectionErrorCategory };

export interface ConnectionTester {
  test(input: ConnectionTestInput): Promise<ConnectionTestResult>;
}

/** Connect + query timeout budget (spec 08 default ~5s; an unreachable host becomes `failed`). */
const TIMEOUT_MS = 5000;

/**
 * Live mysql2-backed tester. Opens a SHORT-LIVED connection, runs only side-effect-free
 * reads (`SELECT 1`, `SHOW GRANTS`), and ALWAYS closes it in `finally`. When `ssl` is true
 * it attempts TLS with certificate verification and never downgrades to plaintext (a TLS
 * failure → `ssl_error`). The raw driver error is inspected only to pick a safe category.
 */
export function createMysqlConnectionTester(): ConnectionTester {
  return {
    async test(input: ConnectionTestInput): Promise<ConnectionTestResult> {
      let connection: Awaited<ReturnType<typeof createConnection>> | undefined;
      try {
        connection = await createConnection({
          host: input.host,
          port: input.port,
          user: input.username,
          password: input.password,
          database: input.database,
          connectTimeout: TIMEOUT_MS,
          ssl: input.ssl ? { rejectUnauthorized: true } : undefined,
        });

        await connection.query({ sql: 'SELECT 1', timeout: TIMEOUT_MS });

        const [rows] = await connection.query({
          sql: 'SHOW GRANTS FOR CURRENT_USER()',
          timeout: TIMEOUT_MS,
        });
        const grants = (rows as Record<string, unknown>[]).map((row) =>
          String(Object.values(row)[0] ?? ''),
        );
        if (analyzeGrants(grants).overPrivileged) {
          return { outcome: 'over_privileged' };
        }
        return { outcome: 'ok' };
      } catch (error) {
        return { outcome: 'failed', category: mapMysqlError(error) };
      } finally {
        if (connection) {
          await connection.end().catch(() => {
            /* closing a half-open connection can throw; ignore */
          });
        }
      }
    },
  };
}
