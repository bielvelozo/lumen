import { resolve } from 'node:path';
import { config } from 'dotenv';

// Load the repo-root .env before any test file is collected, so the env-gated live suites see
// DATABASE_URL / MYSQL_URL. Existing process env wins (dotenv does not override), so a shell
// export or CI secret still takes precedence.
config({ path: resolve(import.meta.dirname, '..', '..', '..', '.env') });
