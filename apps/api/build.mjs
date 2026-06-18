// Production bundle for the API (spec 16). esbuild inlines the JIT workspace package
// `@lumen/shared` (consumed as TS source) and externalizes every real runtime dependency, so the
// final Docker image carries one built file + the prod node_modules — no source, no dev deps, no
// tests. Native/dynamic deps (argon2, pg, mysql2, sentry, ai SDK, fastify) stay external and are
// loaded from node_modules at runtime.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => d !== '@lumen/shared');

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external,
  logLevel: 'info',
});
