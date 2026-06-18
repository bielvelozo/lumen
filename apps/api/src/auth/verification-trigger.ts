/**
 * Port for kicking off email verification after a tenant is created. Spec 03 only
 * *triggers* verification; the real token generation + Resend email is spec 04, which
 * binds a concrete implementation of this port. Keeping it a seam lets signup commit
 * the tenant and call verification best-effort without depending on spec 04's internals.
 */
export interface VerificationTrigger {
  /**
   * Begin email verification for a freshly created owner. MUST be called only AFTER
   * the signup transaction commits (the user row must exist with an id). Implementations
   * are best-effort: a transient failure must not roll back the tenant — the caller
   * swallows errors and the user can re-trigger via spec 04's resend path.
   */
  triggerForNewUser(userId: string, email: string): Promise<void>;
}

/**
 * No-op trigger used until spec 04 lands. It performs no send (there is no token/email
 * machinery yet) and never throws. It logs a single non-sensitive line so the seam is
 * observable in dev; it never logs the raw email body or any secret.
 */
export const noopVerificationTrigger: VerificationTrigger = {
  async triggerForNewUser(): Promise<void> {
    // Intentionally a no-op. Spec 04 replaces this with the Resend-backed flow.
    // (No console output: signup must stay silent about whether an account exists.)
  },
};
