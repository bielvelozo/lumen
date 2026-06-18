import type { Env } from '@lumen/shared';
import { buildApp } from './app';
import { loadEnv } from './env';
import { makeDb } from './db/client';
import { hashPassword, generateToken, hashToken } from './crypto';
import { createSignupService } from './auth/signup.service';
import { makeDrizzleSignupStore } from './auth/signup.store';
import { createVerificationService } from './auth/verification.service';
import { makeDrizzleVerificationStore } from './auth/verification.store';
import { makeEmailSender } from './auth/email-sender';
import { createInMemoryRateLimiter } from './auth/rate-limiter';

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

// Email verification (spec 04). The verification service doubles as signup's
// VerificationTrigger, so the real issue-on-signup flow replaces the spec-03 no-op.
const verificationService = createVerificationService({
  store: makeDrizzleVerificationStore(db),
  emailSender: makeEmailSender(env),
  rateLimiter: createInMemoryRateLimiter({ limit: 3, windowMs: 60 * 60 * 1000 }),
  generateToken,
  hashToken,
  appUrl: env.APP_URL,
});

const signupService = createSignupService({
  store: makeDrizzleSignupStore(db),
  hashPassword,
  verificationTrigger: verificationService,
});

const app = buildApp({ signupService, verificationService });

app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then((address) => {
    console.log(`Lumen API listening on ${address}`);
  })
  .catch((error: unknown) => {
    console.error('Failed to start API:', error);
    process.exit(1);
  });
