import type { Env } from '@lumen/shared';
import { buildApp } from './app';
import { loadEnv } from './env';
import { makeDb } from './db/client';
import { hashPassword } from './crypto';
import { createSignupService } from './auth/signup.service';
import { makeDrizzleSignupStore } from './auth/signup.store';
import { noopVerificationTrigger } from './auth/verification-trigger';

// Validate the environment first — fail fast with a readable message, never a deep
// stack trace, if a required var is missing or malformed.
let env: Env;
try {
  env = loadEnv();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

// Wire the real dependencies from validated env. The pg pool connects lazily, so this
// does not require a live DB at construction time.
const { db } = makeDb(env.DATABASE_URL);
const signupService = createSignupService({
  store: makeDrizzleSignupStore(db),
  hashPassword,
  // Spec 04 swaps in the Resend-backed trigger; until then signup commits the tenant
  // and the no-op trigger keeps the seam in place.
  verificationTrigger: noopVerificationTrigger,
});

const app = buildApp({ signupService });

app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then((address) => {
    console.log(`Lumen API listening on ${address}`);
  })
  .catch((error: unknown) => {
    console.error('Failed to start API:', error);
    process.exit(1);
  });
