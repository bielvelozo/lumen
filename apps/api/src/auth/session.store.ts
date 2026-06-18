import { and, eq, gt, isNull } from 'drizzle-orm';
import { refreshTokens, users } from '../db/schema';
import type { Database } from '../db/client';

/** The auth-relevant user fields login needs. */
export interface LoginUser {
  id: string;
  orgId: string;
  email: string;
  passwordHash: string;
  emailVerified: boolean;
}

/**
 * Outcome of a refresh-token rotation:
 * - `rotated`: the presented token was live; it is now revoked and a new row was inserted.
 * - `reuse_detected`: the presented token was ALREADY revoked (reuse after rotation) — the
 *   whole token family for that user has been revoked as a defense-in-depth response.
 * - `invalid`: unknown or expired token; nothing changed.
 */
/** Identity needed to mint the new access token + session after a rotation. */
export interface RotatedUser {
  id: string;
  orgId: string;
  email: string;
}

export type RotateRefreshResult =
  | { outcome: 'rotated'; user: RotatedUser }
  | { outcome: 'reuse_detected'; userId: string }
  | { outcome: 'invalid' };

/**
 * Persistence port for login + refresh-token lifecycle. The hashed-only storage,
 * atomic rotation, and reuse detection live here so the service stays orchestration.
 */
export interface SessionStore {
  findUserByEmailForLogin(email: string): Promise<LoginUser | null>;
  createRefreshToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  rotateRefreshToken(
    presentedHash: string,
    now: Date,
    newTokenHash: string,
    newExpiresAt: Date,
  ): Promise<RotateRefreshResult>;
  /** Idempotently revoke the row matching `presentedHash` (logout). */
  revokeRefreshToken(presentedHash: string, now: Date): Promise<void>;
}

export function makeDrizzleSessionStore(db: Database): SessionStore {
  return {
    async findUserByEmailForLogin(email: string): Promise<LoginUser | null> {
      const rows = await db
        .select({
          id: users.id,
          orgId: users.orgId,
          email: users.email,
          passwordHash: users.passwordHash,
          emailVerified: users.emailVerified,
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      return rows[0] ?? null;
    },

    async createRefreshToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
      await db.insert(refreshTokens).values({ userId, tokenHash, expiresAt });
    },

    async rotateRefreshToken(
      presentedHash: string,
      now: Date,
      newTokenHash: string,
      newExpiresAt: Date,
    ): Promise<RotateRefreshResult> {
      return db.transaction(async (tx) => {
        // Atomic claim: revoke the presented token only if still live (no TOCTOU).
        const claimed = await tx
          .update(refreshTokens)
          .set({ revokedAt: now })
          .where(
            and(
              eq(refreshTokens.tokenHash, presentedHash),
              isNull(refreshTokens.revokedAt),
              gt(refreshTokens.expiresAt, now),
            ),
          )
          .returning({ userId: refreshTokens.userId });

        const row = claimed[0];
        if (row) {
          await tx
            .insert(refreshTokens)
            .values({ userId: row.userId, tokenHash: newTokenHash, expiresAt: newExpiresAt });
          const userRows = await tx
            .select({ id: users.id, orgId: users.orgId, email: users.email })
            .from(users)
            .where(eq(users.id, row.userId))
            .limit(1);
          const user = userRows[0];
          if (!user) throw new Error('refresh token references a missing user');
          return { outcome: 'rotated', user };
        }

        // Nothing claimed: detect reuse of an already-revoked token vs unknown/expired.
        const existing = await tx
          .select({ userId: refreshTokens.userId, revokedAt: refreshTokens.revokedAt })
          .from(refreshTokens)
          .where(eq(refreshTokens.tokenHash, presentedHash))
          .limit(1);
        const ex = existing[0];
        if (ex && ex.revokedAt !== null) {
          // Reuse after rotation — nuke the whole family (all live tokens for the user).
          await tx
            .update(refreshTokens)
            .set({ revokedAt: now })
            .where(and(eq(refreshTokens.userId, ex.userId), isNull(refreshTokens.revokedAt)));
          return { outcome: 'reuse_detected', userId: ex.userId };
        }
        return { outcome: 'invalid' };
      });
    },

    async revokeRefreshToken(presentedHash: string, now: Date): Promise<void> {
      await db
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.tokenHash, presentedHash), isNull(refreshTokens.revokedAt)));
    },
  };
}
