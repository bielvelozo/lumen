import type { SignupRequest, SignupResponse } from '@lumen/shared';
import type { SignupStore } from './signup.store';
import type { VerificationTrigger } from './verification-trigger';

/**
 * The uniform, non-identifying signup response. Returned for BOTH a fresh signup and a
 * duplicate email so the endpoint never reveals whether an account already exists
 * (anti-enumeration). It carries no `org_id`, `user_id`, or session.
 */
const SIGNUP_OK: SignupResponse = {
  message: 'Account request received. Check your email to verify your address.',
};

export interface SignupServiceDeps {
  store: SignupStore;
  /** argon2id hasher from spec 02 (injected so unit tests can stub it). */
  hashPassword(plain: string): Promise<string>;
  verificationTrigger: VerificationTrigger;
}

export interface SignupService {
  signup(input: SignupRequest): Promise<SignupResponse>;
}

/**
 * Orchestrates signup over the injected ports. Order matters for the constitution and
 * for anti-enumeration:
 *  1. Hash the password on EVERY request (even a duplicate) — only the hash reaches the
 *     store, and the work is uniform so timing doesn't betray existence.
 *  2. Create the tenant atomically (store owns the transaction + unique handling).
 *  3. On `created` only, fire verification AFTER commit, best-effort: a send failure is
 *     swallowed (it must not roll back the tenant nor change the observable response).
 *  4. Return the SAME uniform response regardless of created/duplicate.
 */
export function createSignupService(deps: SignupServiceDeps): SignupService {
  const { store, hashPassword, verificationTrigger } = deps;

  return {
    async signup(input: SignupRequest): Promise<SignupResponse> {
      const passwordHash = await hashPassword(input.password);

      const result = await store.createTenant({
        email: input.email,
        passwordHash,
        organizationName: input.organizationName,
      });

      if (result.outcome === 'created') {
        // Best-effort, post-commit. Never let a verification failure surface to the client
        // or roll back the committed tenant.
        try {
          await verificationTrigger.triggerForNewUser(result.userId, input.email);
        } catch {
          // Swallowed by design — the user can re-trigger via spec 04's resend path.
        }
      }

      return SIGNUP_OK;
    },
  };
}
