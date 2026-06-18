import type { Env } from '@lumen/shared';
import { buildApp } from './app';
import { loadEnv } from './env';
import { makeDb } from './db/client';
import { hashPassword, verifyPassword, generateToken, hashToken } from './crypto';
import { createSignupService } from './auth/signup.service';
import { makeDrizzleSignupStore } from './auth/signup.store';
import { createVerificationService } from './auth/verification.service';
import { makeDrizzleVerificationStore } from './auth/verification.store';
import { makeEmailSender } from './auth/email-sender';
import { createInMemoryRateLimiter } from './auth/rate-limiter';
import { createAccessTokenService } from './auth/jwt';
import { makeDrizzleSessionStore } from './auth/session.store';
import { createAuthService } from './auth/auth.service';

// Access token ~15 min; refresh 30 days (fixed lifetime, v1). See DECISIONS.md.
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

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

// Email verification (spec 04). Its service doubles as signup's VerificationTrigger.
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

// Login / JWT / sessions (spec 05). The dummy hash makes unknown-email logins take the
// same time as a wrong password (no timing oracle); computed once at startup.
const accessTokenService = createAccessTokenService({
  secret: env.JWT_SECRET,
  ttlSeconds: ACCESS_TTL_SECONDS,
});
const dummyPasswordHash = await hashPassword('lumen-login-timing-guard');
const authService = createAuthService({
  store: makeDrizzleSessionStore(db),
  verifyPassword,
  dummyPasswordHash,
  generateToken,
  hashToken,
  accessTokenService,
  loginRateLimiter: createInMemoryRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 }),
  refreshTtlMs: REFRESH_TTL_SECONDS * 1000,
});

const app = buildApp({
  signupService,
  verificationService,
  auth: {
    authService,
    accessTokenService,
    accessTtlSeconds: ACCESS_TTL_SECONDS,
    refreshTtlSeconds: REFRESH_TTL_SECONDS,
  },
});

app
  .listen({ port: env.PORT, host: '0.0.0.0' })
  .then((address) => {
    console.log(`Lumen API listening on ${address}`);
  })
  .catch((error: unknown) => {
    console.error('Failed to start API:', error);
    process.exit(1);
  });
