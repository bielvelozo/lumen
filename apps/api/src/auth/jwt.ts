import { SignJWT, jwtVerify } from 'jose';
import type { AuthenticatedUser } from '@lumen/shared';

/**
 * Access-token service: signs/verifies the short-lived access JWT (HS256, `jose`). The
 * claims are exactly the caller identity `{ userId, orgId }` that `requireAuth` attaches
 * to the request — `orgId` from here is the only sanctioned tenant id (invariant 1). The
 * raw token rides in an httpOnly cookie and is never returned in a body.
 */
export interface AccessTokenService {
  sign(claims: AuthenticatedUser): Promise<string>;
  /** Verify + decode; returns the claims, or `null` for any invalid/expired/tampered token. */
  verify(token: string): Promise<AuthenticatedUser | null>;
}

export interface AccessTokenOptions {
  /** `JWT_SECRET` from validated env. Encoded to bytes for HS256. */
  secret: string;
  /** Access-token lifetime in seconds (short — ~15 min). */
  ttlSeconds: number;
}

const ALG = 'HS256';

export function createAccessTokenService(options: AccessTokenOptions): AccessTokenService {
  const key = new TextEncoder().encode(options.secret);

  return {
    async sign(claims: AuthenticatedUser): Promise<string> {
      return new SignJWT({ userId: claims.userId, orgId: claims.orgId })
        .setProtectedHeader({ alg: ALG })
        .setIssuedAt()
        .setExpirationTime(`${options.ttlSeconds}s`)
        .sign(key);
    },

    async verify(token: string): Promise<AuthenticatedUser | null> {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: [ALG] });
        const userId = payload.userId;
        const orgId = payload.orgId;
        if (typeof userId !== 'string' || typeof orgId !== 'string') return null;
        return { userId, orgId };
      } catch {
        // Expired, tampered, wrong secret, malformed — all collapse to "not authenticated".
        return null;
      }
    },
  };
}
