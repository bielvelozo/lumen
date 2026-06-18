import type { Env } from '@lumen/shared';
import { buildApp } from './app';
import { loadEnv } from './env';
import { initSentry } from './observability/sentry';
import { makeDb } from './db/client';
import { hashPassword, verifyPassword, generateToken, hashToken, createCryptoModule } from './crypto';
import { createSignupService } from './auth/signup.service';
import { makeDrizzleSignupStore } from './auth/signup.store';
import { createVerificationService } from './auth/verification.service';
import { makeDrizzleVerificationStore } from './auth/verification.store';
import { makeEmailSender } from './auth/email-sender';
import { createInMemoryRateLimiter } from './auth/rate-limiter';
import { createAccessTokenService } from './auth/jwt';
import { makeDrizzleSessionStore } from './auth/session.store';
import { createAuthService } from './auth/auth.service';
import { makeDrizzleConsentStore } from './db-connection/consent.store';
import { createConsentService } from './db-connection/consent.service';
import { makeDrizzleDbConnectionStore } from './db-connection/db-connection.store';
import { createDbConnectionService } from './db-connection/db-connection.service';
import { createMysqlConnectionTester } from './db-connection/connection-tester';
import { makeDrizzleExposureStore } from './db-connection/exposure.store';
import { createExposureService } from './db-connection/exposure.service';
import { createMysqlSchemaIntrospector } from './db-connection/schema-introspector';
import { makeDrizzleAiConnectionStore } from './ai-connection/ai-connection.store';
import { createAiConnectionService } from './ai-connection/ai-connection.service';
import { createAiSdkValidator } from './ai-connection/claude-validator';
import { makeDrizzleChatStore } from './chat/chat.store';
import { makeDrizzleFunctionLogStore } from './chat/function-log.store';
import { createChatService } from './chat/chat.service';
import { createAiSdkChatModel } from './chat/chat-model';
import { makeDrizzleAllowListAccessor } from './query-registry/allow-list';
import { createMysql2QueryRunner } from './query-registry/query-runner';
import { makeDrizzleAuditStore } from './audit/audit.store';

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

// Observability (spec 15) — init BEFORE building the app so early errors are captured. No DSN
// ⇒ disabled cleanly (local dev boots without Sentry). The scrubber strips secrets/PII/raw rows.
const sentryEnabled = initSentry(env);
console.log(sentryEnabled ? 'Sentry enabled' : 'Sentry disabled (no SENTRY_DSN)');

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

// DB-connection consent + onboarding script (spec 07) + create/test connection (spec 08).
const consentService = createConsentService(makeDrizzleConsentStore(db));
const crypto = createCryptoModule(env); // encrypt/decrypt the client-DB password (spec 02)
const dbConnectionStore = makeDrizzleDbConnectionStore(db);
const dbConnectionService = createDbConnectionService({
  store: dbConnectionStore,
  tester: createMysqlConnectionTester(),
  consentService,
  encrypt: crypto.encrypt,
  decrypt: crypto.decrypt,
});

// Introspection + exposure allow-list (spec 09).
const exposureService = createExposureService({
  connectionStore: dbConnectionStore,
  introspector: createMysqlSchemaIntrospector(),
  exposureStore: makeDrizzleExposureStore(db),
  decrypt: crypto.decrypt,
});

// Connect the AI — Claude BYO key (spec 11). Validation uses the Vercel AI SDK; the same
// crypto module encrypts the key at rest. The plaintext key never leaves the service scope.
const aiConnectionService = createAiConnectionService({
  store: makeDrizzleAiConnectionStore(db),
  validator: createAiSdkValidator(),
  encrypt: crypto.encrypt,
  decrypt: crypto.decrypt,
});

// Chat orchestrator (spec 13) — ties Claude (Vercel AI SDK) + the query-function registry +
// the read-only MySQL. The same crypto module decrypts the Claude key + MySQL password
// in-process per request; neither plaintext is ever logged or persisted.
const chatStore = makeDrizzleChatStore(db);
const chatService = createChatService({
  chatStore,
  logStore: makeDrizzleFunctionLogStore(db),
  aiConnectionStore: makeDrizzleAiConnectionStore(db),
  allowListAccessor: makeDrizzleAllowListAccessor(db),
  runner: createMysql2QueryRunner({ decrypt: crypto.decrypt }),
  modelPort: createAiSdkChatModel(),
  decrypt: crypto.decrypt,
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
  dbConnection: { consentService, dbConnectionService, exposureService, accessTokenService },
  aiConnection: { aiConnectionService, accessTokenService },
  chat: { service: chatService, chatStore, accessTokenService },
  audit: { auditStore: makeDrizzleAuditStore(db), accessTokenService },
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
