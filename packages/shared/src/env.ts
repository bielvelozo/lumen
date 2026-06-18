import { z } from 'zod';

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
  SECRETS_ENCRYPTION_KEY: z.string().min(1, 'SECRETS_ENCRYPTION_KEY is required'),
  // JWT signing secret for the auth cookie (spec 05).
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),

  // Runtime — defaulted.
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  // Deferred external services — optional until their owning spec lands. Empty
  // string means "absent": the owning spec binds a fake and skips live tests.
  RESEND_API_KEY: z.string().default(''),
  ANTHROPIC_API_KEY: z.string().default(''),
  SENTRY_DSN: z.string().default(''),
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
