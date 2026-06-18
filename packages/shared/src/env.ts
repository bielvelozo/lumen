import { z } from 'zod';

/**
 * Decoded byte length of a standard (padded) base64 string, or `null` if the value
 * is not well-formed base64. Pure string math so this package stays free of Node
 * globals (`Buffer`) — the API decodes the validated value with `Buffer` later.
 */
function base64ByteLength(value: string): number | null {
  if (value.length === 0 || value.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  return (value.length / 4) * 3 - padding;
}

/**
 * The single source of truth for the project's environment contract.
 *
 * Every variable the project consumes is declared here and validated at API
 * startup (fail fast). Variables for not-yet-built features are present but
 * optional/defaulted so the build runs before those features exist. Required
 * secrets (DB URLs, encryption key, JWT secret) must be present and non-empty.
 */
export const envSchema = z.object({
  // App database (PostgreSQL) — required.
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid connection URL'),
  // Client database stand-in (MySQL) — required for the connection specs.
  MYSQL_URL: z.string().url('MYSQL_URL must be a valid connection URL'),
  // 32-byte AES-256-GCM master key (base64) for encryption-at-rest (spec 02).
  // Validated to decode to EXACTLY 32 bytes so the API never boots with a wrong-
  // length or silently-truncated key (fail fast — spec 02 invariant).
  SECRETS_ENCRYPTION_KEY: z
    .string()
    .min(1, 'SECRETS_ENCRYPTION_KEY is required')
    .refine((value) => base64ByteLength(value) === 32, {
      message:
        'SECRETS_ENCRYPTION_KEY must be a base64-encoded 32-byte key ' +
        '(generate: `openssl rand -base64 32`)',
    }),
  // JWT signing secret for the access-token cookie (spec 05). HS256 — a weak/short
  // secret is offline-brute-forceable and would let an attacker forge tokens (full
  // tenant takeover), so enforce a 32-char floor (>= the 256-bit hash output), mirroring
  // SECRETS_ENCRYPTION_KEY's rigor. Generate: `openssl rand -base64 48`.
  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters of high-entropy randomness'),

  // Runtime — defaulted.
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Public base URL of the SPA — used to build the email-verification link
  // `{APP_URL}/verify-email?token=...` (spec 04). Defaults to the Vite dev server.
  APP_URL: z.string().url('APP_URL must be a valid URL').default('http://localhost:5173'),
  // Cross-site CORS allow-list (spec 16): the production Pages origin(s) permitted to call the API
  // WITH credentials. Comma-separated; NEVER `*` (the browser rejects `*` + credentials). Defaults
  // to the local Vite dev origin so dev works without config.
  WEB_ORIGIN: z.string().default('http://localhost:5173'),

  // Deferred external services — optional until their owning spec lands. Empty
  // string means "absent": the owning spec binds a fake and skips live tests.
  RESEND_API_KEY: z.string().default(''),
  // Sender identity for transactional email (spec 04). `onboarding@resend.dev` is
  // Resend's shared sandbox sender; a verified custom domain is a deploy-time (spec 16)
  // human/DNS step.
  RESEND_FROM_EMAIL: z.string().default('Lumen <onboarding@resend.dev>'),
  ANTHROPIC_API_KEY: z.string().default(''),
  // Observability (spec 15). Empty DSN = Sentry disabled (local dev boots without it).
  SENTRY_DSN: z.string().default(''),
  SENTRY_ENVIRONMENT: z.string().default('development'),
  // Conservative default trace sample rate; tuned per-environment at deploy (spec 16).
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),
});

export type Env = z.infer<typeof envSchema>;

/** Thrown when the environment fails validation. Carries a human-readable list. */
export class EnvValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvValidationError';
  }
}

/**
 * Validate a raw environment source (e.g. `process.env`) against {@link envSchema}.
 * Throws {@link EnvValidationError} with a readable, multi-line message naming each
 * offending variable — never a deep stack trace. The caller passes the source
 * explicitly so this package stays free of Node globals.
 */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new EnvValidationError(
      `Invalid environment configuration:\n${issues}\n` + 'Check your .env against .env.example.',
    );
  }
  return result.data;
}
