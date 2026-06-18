import { resolve } from 'node:path';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

// Load the repo-root .env when DATABASE_URL isn't already set (production/CI provides
// it directly; dotenv never overrides an existing value). Run via `pnpm db:migrate`.
config({ path: resolve(import.meta.dirname, '..', '..', '..', '..', '.env') });

const MIGRATIONS_FOLDER = resolve(import.meta.dirname, '..', '..', 'drizzle');

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required to run migrations.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log('Migrations applied successfully.');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exitCode = 1;
});
