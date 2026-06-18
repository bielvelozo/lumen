/**
 * Consent + onboarding-script contracts for connecting the client DB (spec 07). The terms
 * text is a VERSIONED constant here so the accepted `consent_version` maps deterministically
 * to the exact wording the owner saw. No secret/credential is part of this slice (spec 08).
 */
import { z } from 'zod';

/** The current terms version. Bumping this forces re-acceptance (stale consent is gated). */
export const CURRENT_CONSENT_VERSION = '1';

/**
 * The four concrete scope points the owner accepts (plain language; exact legal copy is out
 * of scope). Pinned to {@link CURRENT_CONSENT_VERSION}.
 */
export const CONSENT_TERMS = {
  version: CURRENT_CONSENT_VERSION,
  points: [
    'O acesso ao seu banco de dados é somente leitura (read-only).',
    'Você escolhe quais tabelas o assistente pode ver — nada é exposto por padrão.',
    'Qualquer credencial que você fornecer é criptografada em repouso, e a chave de descriptografia fica fora do banco de dados.',
    'A conexão pode ser revogada a qualquer momento.',
  ],
} as const;

/**
 * `POST /db-connection/consent` request. The client echoes the version it is accepting; the
 * server rejects it if it is not the current version (terms changed). `.strict()` — no
 * `org_id` is accepted (it comes from the JWT).
 */
export const acceptConsentRequestSchema = z
  .object({
    consentVersion: z.string().min(1),
  })
  .strict();

export type AcceptConsentRequest = z.infer<typeof acceptConsentRequestSchema>;

/** `GET /db-connection/consent` response — whether the org has accepted the CURRENT version. */
export const consentStatusResponseSchema = z.object({
  currentVersion: z.string(),
  acceptedVersion: z.string().nullable(),
  /** True iff `acceptedVersion === currentVersion`. */
  accepted: z.boolean(),
});

export type ConsentStatusResponse = z.infer<typeof consentStatusResponseSchema>;

/** A safe MySQL identifier (user / database name) embedded into the generated script. */
export const sqlIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_]+$/, 'Use only letters, numbers and underscores');

/**
 * `POST /db-connection/onboarding-script` request. All optional/non-secret: a suggested
 * username, an optional database name to scope the grant, and whether to include the
 * commented `REQUIRE SSL` recommendation. NEVER a password.
 */
export const onboardingScriptRequestSchema = z
  .object({
    username: sqlIdentifierSchema.optional(),
    databaseName: sqlIdentifierSchema.optional(),
    requireSsl: z.boolean().optional(),
  })
  .strict();

export type OnboardingScriptRequest = z.infer<typeof onboardingScriptRequestSchema>;

/** `POST /db-connection/onboarding-script` response — the copy-pasteable script. */
export const onboardingScriptResponseSchema = z.object({
  engine: z.literal('mysql'),
  username: z.string(),
  script: z.string(),
});

export type OnboardingScriptResponse = z.infer<typeof onboardingScriptResponseSchema>;
