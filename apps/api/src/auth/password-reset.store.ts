import { and, eq, gt, isNull } from 'drizzle-orm';
import { passwordResetTokens, refreshTokens, users } from '../db/schema';
import type { Database } from '../db/client';

/**
 * Persistence port for password reset. Implemented by {@link makeDrizzlePasswordResetStore};
 * faked in unit tests. The single-use guarantee and the "a reset ends every other session"
 * rule live here, in one transaction, so the service stays orchestration.
 */
export interface PasswordResetStore {
  /** The user id behind a (normalized) email, or null. Never reveals anything to the caller. */
  findUserIdByEmail(email: string): Promise<string | null>;
  /** Invalidate the user's prior unused reset tokens and insert a new one (one transaction). */
  issue(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  /**
   * Atomically consume a token by hash and set the new password hash. Returns false when the
   * token is unknown, expired or already spent.
   */
  consume(tokenHash: string, now: Date, newPasswordHash: string): Promise<boolean>;
}

export function makeDrizzlePasswordResetStore(db: Database): PasswordResetStore {
  return {
    async findUserIdByEmail(email: string): Promise<string | null> {
      const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      return rows[0]?.id ?? null;
    },

    async issue(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
      await db.transaction(async (tx) => {
        // Most-recent-wins: an older link must stop working the moment a new one is sent.
        await tx
          .update(passwordResetTokens)
          .set({ usedAt: new Date() })
          .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
        await tx.insert(passwordResetTokens).values({ userId, tokenHash, expiresAt });
      });
    },

    async consume(tokenHash: string, now: Date, newPasswordHash: string): Promise<boolean> {
      return db.transaction(async (tx) => {
        // Single conditional UPDATE — no read-then-write (no TOCTOU). 0 rows ⇒ not consumable
        // (unknown / expired / already used), all collapsed into one answer.
        const consumed = await tx
          .update(passwordResetTokens)
          .set({ usedAt: now })
          .where(
            and(
              eq(passwordResetTokens.tokenHash, tokenHash),
              isNull(passwordResetTokens.usedAt),
              gt(passwordResetTokens.expiresAt, now),
            ),
          )
          .returning({ userId: passwordResetTokens.userId });

        const row = consumed[0];
        if (!row) return false;

        await tx.update(users).set({ passwordHash: newPasswordHash }).where(eq(users.id, row.userId));
        // Whoever knew the old password (or held a stolen session) is logged out: the reset is
        // the account-recovery path, so every live refresh token for this user dies with it.
        await tx
          .update(refreshTokens)
          .set({ revokedAt: now })
          .where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)));
        return true;
      });
    },
  };
}
