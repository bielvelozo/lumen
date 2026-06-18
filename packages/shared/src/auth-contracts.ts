/**
 * Auth request/response contracts shared across the API/web boundary (spec 03 signup;
 * later consumed by spec 06's form, single source of truth). Types/Zod only — no Node
 * crypto or DB access here.
 */
import { z } from 'zod';

/** Minimum password length (spec 03 open-question default; recorded in DECISIONS.md). */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * A small denylist of the most common >=8-char passwords (compared case-insensitively).
 * Intentionally minimal — UX over heavy composition rules. Shorter common passwords are
 * already rejected by the length check. Extend as needed; do not turn into a megabyte list.
 */
export const COMMON_PASSWORD_DENYLIST: ReadonlySet<string> = new Set([
  'password',
  'password1',
  'password123',
  'passw0rd',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyuiop',
  'iloveyou',
  'admin123',
  'letmein1',
  'welcome1',
  'sunshine',
  'football',
  'baseball',
  'abcd1234',
  '11111111',
  '00000000',
]);

/**
 * `POST /auth/signup` request. `.strict()` rejects unknown fields (anti-IDOR boundary:
 * the endpoint mints `org_id` server-side and never accepts one). `email` is trimmed +
 * lowercased so case/whitespace variants can't bypass the UNIQUE constraint; the
 * password is left verbatim (spaces may be intentional) and only length/denylist-checked;
 * `organizationName` is trimmed and length-bounded.
 */
export const signupRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('A valid email is required'),
    password: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
      .max(200, 'Password is too long')
      .refine((value) => !COMMON_PASSWORD_DENYLIST.has(value.toLowerCase()), {
        message: 'Password is too common — choose a less guessable one',
      }),
    organizationName: z
      .string()
      .trim()
      .min(1, 'Organization name is required')
      .max(120, 'Organization name is too long'),
  })
  .strict();

/** Normalized signup input (post-transform) — what the API works with. */
export type SignupRequest = z.infer<typeof signupRequestSchema>;
/** Raw signup input (pre-transform) — what a form/client sends. */
export type SignupRequestInput = z.input<typeof signupRequestSchema>;

/**
 * `POST /auth/signup` response. Deliberately minimal and non-identifying: never returns
 * `org_id`, `user_id`, or a session. The same body is returned for a fresh signup and a
 * duplicate email (anti-enumeration).
 */
export const signupResponseSchema = z.object({
  message: z.string(),
});

export type SignupResponse = z.infer<typeof signupResponseSchema>;

// ---------------------------------------------------------------------------
// Login & sessions (spec 05)
// ---------------------------------------------------------------------------

/**
 * `POST /auth/login` request. Email is normalized like signup; the password is only
 * checked for presence here (strength is a signup-time concern). `.strict()` rejects
 * unknown fields — the endpoint never accepts an `org_id` (anti-IDOR).
 */
export const loginRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('A valid email is required'),
    password: z.string().min(1, 'Password is required'),
  })
  .strict();

export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * The minimal session payload returned by `POST /auth/login` and `GET /auth/me`. Carries
 * NO token material (the access/refresh tokens live only in httpOnly cookies).
 */
export const sessionResponseSchema = z.object({
  userId: z.string().uuid(),
  orgId: z.string().uuid(),
  email: z.string().email(),
});

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

/**
 * The verified-caller identity extracted from the access JWT by the `requireAuth`
 * decorator and attached to the request. `orgId` here is the ONLY sanctioned source of
 * the tenant id for downstream handlers (constitution invariant 1, anti-IDOR).
 */
export interface AuthenticatedUser {
  userId: string;
  orgId: string;
}

// ---------------------------------------------------------------------------
// Email verification (spec 04)
// ---------------------------------------------------------------------------

/**
 * `POST /auth/verify-email` request. The opaque raw token from the email link — the ONLY
 * thing the client sends. `.strict()` rejects a client-supplied `user_id`/token id
 * (anti-IDOR): the user to flip is derived server-side from the hash-matched row.
 */
export const verifyEmailRequestSchema = z
  .object({
    token: z.string().min(1, 'A verification token is required'),
  })
  .strict();

export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

/**
 * Outcome of a verify attempt. `verified` (happy), `already_verified` (benign double-click),
 * `invalid` (unknown/expired/used/garbage — all collapsed so nothing is leaked, never a 500).
 */
export const verifyEmailResponseSchema = z.object({
  status: z.enum(['verified', 'already_verified', 'invalid']),
});

export type VerifyEmailStatus = VerifyEmailResponse['status'];
export type VerifyEmailResponse = z.infer<typeof verifyEmailResponseSchema>;

/**
 * `POST /auth/resend-verification` request. Email is trimmed + lowercased (same
 * normalization as signup). `.strict()` rejects unknown fields.
 */
export const resendVerificationRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('A valid email is required'),
  })
  .strict();

export type ResendVerificationRequest = z.infer<typeof resendVerificationRequestSchema>;

/**
 * `POST /auth/resend-verification` response. ALWAYS the same generic body — for an
 * existing-unverified, an already-verified, AND a non-existent email — so the endpoint
 * never reveals account existence or verification state (anti-enumeration).
 */
export const resendVerificationResponseSchema = z.object({
  message: z.string(),
});

export type ResendVerificationResponse = z.infer<typeof resendVerificationResponseSchema>;
