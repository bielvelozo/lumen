import { resolve } from 'node:path';
import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit bundles this config as CJS, so `import.meta` is unavailable here —
// use process.cwd() (drizzle-kit runs with cwd = apps/api). Only `generate` uses
// this config in the build; it does not connect to the DB. The repo-root .env is
// loaded so `studio`/`push` also work locally when DATABASE_URL is set.
config({ path: resolve(process.cwd(), '..', '..', '.env') });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/lumen',
  },
});
