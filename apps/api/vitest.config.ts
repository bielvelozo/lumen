import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Vitest does not read the repo-root `.env` on its own, so every `describe.skipIf(!DATABASE_URL)`
 * / `!MYSQL_URL` suite silently skipped even with Docker up and the file filled in — dozens of
 * DB-facing tests that only ran when someone remembered to export the vars by hand.
 *
 * NOTE: this also means a filled `ANTHROPIC_API_KEY` turns on the live Claude validator test,
 * which spends real credits. Leave it empty unless that is what you want.
 */
export default defineConfig({
  test: {
    setupFiles: [resolve(import.meta.dirname, 'src', 'setup-test-env.ts')],
  },
});
