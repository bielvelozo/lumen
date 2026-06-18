import type { Env } from '@lumen/shared';
import { buildApp } from './app';
import { loadEnv } from './env';

// Validate the environment first — fail fast with a readable message, never a deep
// stack trace, if a required var is missing or malformed.
let env: Env;
try {
  env = loadEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const app = buildApp();

app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then((address) => {
    console.log(`Lumen API listening on ${address}`);
  })
  .catch((error: unknown) => {
    console.error('Failed to start API:', error);
    process.exit(1);
  });
