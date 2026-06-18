import { resolve } from 'node:path';
import { config } from 'dotenv';

// Load the repo-root .env into process.env BEFORE anything calls loadEnv().
// pnpm runs package scripts with cwd = apps/api, so dotenv's default cwd lookup
// would miss the root .env — resolve the path explicitly (mirrors db/migrate.ts
// and db/seed.ts). dotenv never overrides an already-set var, so production
// (env injected by the secrets manager, no .env file) is unaffected.
config({ path: resolve(import.meta.dirname, '..', '..', '..', '.env') });
