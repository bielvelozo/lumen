import { and, eq, gt, isNull } from 'drizzle-orm';
import type { VerifyEmailStatus } from '@lumen/shared';
import { emailVerificationTokens, users } from '../db/schema';
import type { Database } from '../db/client';

/** Minimal user shape the resend flow needs to decide whether to (re)issue. */
export interface VerificationUser {
  id: string;
  emailVerified: boolean;
}

/**
 * Persistence port for email verification. Implemented by
 * {@link makeDrizzleVerificationStore}; faked in unit tests. The single-use + atomicity
 * guarantees live here so the service stays orchestration.
 */
export interface VerificationStore {
  /** Invalidate the user's prior unused tokens and insert a new one (one transaction). */
  issue(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  /** Atomically consume a token by hash and flip the user; returns the outcome. */
  consume(tokenHash: string, now: Date): Promise<VerifyEmailStatus>;
  /** Look up a user by (normalized) email — used to gate resend. `null` if none. */
  findUserByEmail(email: string): Promise<VerificationUser | null>;
}

export function makeDrizzleVerificationStore(db: Database): VerificationStore {
  return {
    async issue(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
      await db.transaction(async (tx) => {
        // Most-recent-wins: mark the user's still-unused tokens consumed so an older link
        // can no longer verify.
        await tx
          .update(emailVerificationTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(emailVerificationTokens.userId, userId),
              isNull(emailVerificationTokens.usedAt),
            ),
          );
        await tx.insert(emailVerificationTokens).values({ userId, tokenHash, expiresAt });
      });
    },

    async consume(tokenHash: string, now: Date): Promise<VerifyEmailStatus> {
      return db.transaction(async (tx) => {
        // Single conditional UPDATE — no read-then-write (no TOCTOU). 0 rows ⇒ not
        // consumable here (unknown / expired / already used).
        const consumed = await tx
          .update(emailVerificationTokens)
          .set({ usedAt: now })
          .where(
            and(
              eq(emailVerificationTokens.tokenHash, tokenHash),
              isNull(emailVerificationTokens.usedAt),
              gt(emailVerificationTokens.expiresAt, now),
            ),
          )
          .returning({ userId: emailVerificationTokens.userId });

        const row = consumed[0];
        if (row) {
          await tx
            .update(users)
            .set({ emailVerified: true, verifiedAt: now })
            .where(eq(users.id, row.userId));
          return 'verified';
        }

        // Nothing consumed: distinguish a benign double-click (user already verified) from
        // a genuinely invalid link. This read only refines the UX message — the atomic flip
        // already happened (or didn't); it is not a TOCTOU on the write.
        const existing = await tx
          .select({ userId: emailVerificationTokens.userId })
          .from(emailVerificationTokens)
          .where(eq(emailVerificationTokens.tokenHash, tokenHash))
          .limit(1);
        const existingRow = existing[0];
        if (existingRow) {
          const owner = await tx
            .select({ emailVerified: users.emailVerified })
            .from(users)
            .where(eq(users.id, existingRow.userId))
            .limit(1);
          if (owner[0]?.emailVerified) return 'already_verified';
        }
        return 'invalid';
      });
    },

    async findUserByEmail(email: string): Promise<VerificationUser | null> {
      const rows = await db
        .select({ id: users.id, emailVerified: users.emailVerified })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return rows[0] ?? null;
    },
  };
}
