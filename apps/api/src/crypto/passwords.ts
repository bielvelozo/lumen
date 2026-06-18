import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing for `users.password_hash` — a one-way, salted, slow hash. Uses
 * **argon2id** via `@node-rs/argon2` (prebuilt napi binary — no node-gyp, reliable
 * on Windows dev + Linux deploy). A slow, per-hash-salted function is required here
 * (the opposite of the token hash) because the input is low-entropy and
 * attacker-guessable. Parameters are the OWASP argon2id baseline (recorded in
 * `DECISIONS.md`); tune to the VPS at spec 16. The plaintext, the hash, and the
 * length are never logged.
 *
 * NOTE: the library's `Algorithm` enum is an ambient `const enum`, which cannot be
 * referenced as a value under `verbatimModuleSyntax`. `@node-rs/argon2` defaults to
 * **argon2id**, so we omit the `algorithm` option and lock the choice with a test
 * that asserts the produced PHC string begins with `$argon2id$`.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19456, // KiB = 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Hash a plaintext password into a self-describing argon2id PHC string for storage.
 * The salt is generated internally per call, so the same password hashes to a
 * different string each time.
 */
export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against a stored argon2id PHC string. Returns a
 * boolean (constant-time within the library). A malformed/garbage stored hash
 * yields `false` rather than throwing, so a corrupt row can never leak via an
 * error or crash a login.
 */
export async function verifyPassword(plain: string, phcHash: string): Promise<boolean> {
  try {
    return await verify(phcHash, plain);
  } catch {
    return false;
  }
}
