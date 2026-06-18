import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

/**
 * Create a pooled Drizzle client over PostgreSQL (node-postgres). The caller owns
 * the returned `pool` and is responsible for `pool.end()`. A single app-wide
 * instance is wired from the validated env by the feature specs that need it; the
 * factory keeps it testable and lets ops scripts open their own short-lived pool.
 */
export function makeDb(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export type Database = ReturnType<typeof makeDb>['db'];
