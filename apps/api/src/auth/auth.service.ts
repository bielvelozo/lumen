import type { LoginRequest, SessionResponse } from '@lumen/shared';
import type { SessionStore } from './session.store';
import type { AccessTokenService } from './jwt';
import type { RateLimiter } from './rate-limiter';

export type LoginResult =
  | { ok: true; session: SessionResponse; accessToken: string; refreshToken: string }
  | { ok: false; reason: 'invalid_credentials' | 'unverified' | 'rate_limited' };

export type RefreshResult =
  | { ok: true; session: SessionResponse; accessToken: string; refreshToken: string }
  | { ok: false };

export interface AuthServiceDeps {
  store: SessionStore;
  /** spec 02 `verifyPassword` (argon2id, constant-time within the library). */
  verifyPassword(plain: string, hash: string): Promise<boolean>;
  /** A precomputed argon2id hash verified against when the email is unknown (timing guard). */
  dummyPasswordHash: string;
  /** spec 02 `generateToken` — 32-byte CSPRNG raw + its hash. */
  generateToken(): { raw: string; tokenHash: string };
  /** spec 02 `hashToken`. */
  hashToken(raw: string): string;
  accessTokenService: AccessTokenService;
  /** Per-email login limiter (not trivially brute-forceable; full policy deferred to 16). */
  loginRateLimiter: RateLimiter;
  refreshTtlMs: number;
  now?: () => Date;
}

export interface AuthService {
  login(input: LoginRequest): Promise<LoginResult>;
  refresh(rawRefreshToken: string): Promise<RefreshResult>;
  logout(rawRefreshToken: string): Promise<void>;
  /** Resolve the session for a verified caller id (from the JWT) — for `GET /auth/me`. */
  me(userId: string): Promise<SessionResponse | null>;
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const now = deps.now ?? ((): Date => new Date());

  function issueRefresh(): { raw: string; tokenHash: string; expiresAt: Date } {
    const { raw, tokenHash } = deps.generateToken();
    return { raw, tokenHash, expiresAt: new Date(now().getTime() + deps.refreshTtlMs) };
  }

  return {
    async login(input: LoginRequest): Promise<LoginResult> {
      // Rate-limit per email (a non-existent email is limited identically, so the limit
      // state itself doesn't leak existence).
      if (!deps.loginRateLimiter.consume(input.email)) {
        return { ok: false, reason: 'rate_limited' };
      }

      const user = await deps.store.findUserByEmailForLogin(input.email);
      // Always verify a password — against the user's hash, or a dummy hash when the email
      // is unknown — so wrong-password and unknown-email take the same time (no oracle).
      const passwordOk = await deps.verifyPassword(
        input.password,
        user?.passwordHash ?? deps.dummyPasswordHash,
      );
      if (!user || !passwordOk) {
        return { ok: false, reason: 'invalid_credentials' };
      }
      if (!user.emailVerified) {
        return { ok: false, reason: 'unverified' };
      }

      const accessToken = await deps.accessTokenService.sign({
        userId: user.id,
        orgId: user.orgId,
      });
      const refresh = issueRefresh();
      await deps.store.createRefreshToken(user.id, refresh.tokenHash, refresh.expiresAt);

      return {
        ok: true,
        session: { userId: user.id, orgId: user.orgId, email: user.email },
        accessToken,
        refreshToken: refresh.raw,
      };
    },

    async refresh(rawRefreshToken: string): Promise<RefreshResult> {
      const presentedHash = deps.hashToken(rawRefreshToken);
      const next = issueRefresh();
      const result = await deps.store.rotateRefreshToken(
        presentedHash,
        now(),
        next.tokenHash,
        next.expiresAt,
      );
      if (result.outcome !== 'rotated') {
        // 'invalid' (unknown/expired) or 'reuse_detected' (family already revoked) → 401.
        return { ok: false };
      }
      const accessToken = await deps.accessTokenService.sign({
        userId: result.user.id,
        orgId: result.user.orgId,
      });
      return {
        ok: true,
        session: {
          userId: result.user.id,
          orgId: result.user.orgId,
          email: result.user.email,
        },
        accessToken,
        refreshToken: next.raw,
      };
    },

    async logout(rawRefreshToken: string): Promise<void> {
      if (!rawRefreshToken) return; // idempotent: nothing to revoke
      await deps.store.revokeRefreshToken(deps.hashToken(rawRefreshToken), now());
    },

    async me(userId: string): Promise<SessionResponse | null> {
      return deps.store.findSessionUser(userId);
    },
  };
}
