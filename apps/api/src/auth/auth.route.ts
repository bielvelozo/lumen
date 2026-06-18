import type { FastifyInstance } from 'fastify';
import { loginRequestSchema } from '@lumen/shared';
import type { AuthService } from './auth.service';
import type { AccessTokenService } from './jwt';
import { setAuthCookies, clearAuthCookies, REFRESH_COOKIE } from './cookies';
import { makeRequireAuth, getAuth } from './require-auth';
import { validationErrorBody } from './http-validation';

export interface AuthRouteDeps {
  authService: AuthService;
  accessTokenService: AccessTokenService;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

/**
 * Register the session endpoints. `/auth/me` is guarded by `requireAuth` (proof the
 * decorator is the sole `org_id` source). No endpoint returns token material in its body —
 * the access/refresh tokens live only in httpOnly cookies.
 */
export function registerAuthRoutes(app: FastifyInstance, deps: AuthRouteDeps): void {
  const requireAuth = makeRequireAuth(deps.accessTokenService);

  const setSessionCookies = (
    reply: Parameters<typeof setAuthCookies>[0],
    accessToken: string,
    refreshToken: string,
  ): void => {
    setAuthCookies(reply, {
      accessToken,
      accessMaxAgeSeconds: deps.accessTtlSeconds,
      refreshToken,
      refreshMaxAgeSeconds: deps.refreshTtlSeconds,
    });
  };

  app.post('/auth/login', async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(validationErrorBody(parsed.error));
    }
    const result = await deps.authService.login(parsed.data);
    if (!result.ok) {
      if (result.reason === 'unverified') {
        // Distinct, non-enumerating: nudges verification without confirming existence to
        // an outsider (only someone with the correct password reaches this branch).
        return reply
          .code(403)
          .send({ error: 'EmailNotVerified', message: 'Verify your email to continue.' });
      }
      if (result.reason === 'rate_limited') {
        return reply.code(429).send({ error: 'TooManyRequests' });
      }
      return reply.code(401).send({ error: 'InvalidCredentials' });
    }
    setSessionCookies(reply, result.accessToken, result.refreshToken);
    return reply.code(200).send(result.session);
  });

  app.post('/auth/refresh', async (request, reply) => {
    const raw = request.cookies?.[REFRESH_COOKIE] ?? '';
    const result = await deps.authService.refresh(raw);
    if (!result.ok) {
      clearAuthCookies(reply);
      return reply.code(401).send({ error: 'InvalidRefreshToken' });
    }
    setSessionCookies(reply, result.accessToken, result.refreshToken);
    return reply.code(200).send(result.session);
  });

  app.post('/auth/logout', async (request, reply) => {
    // Idempotent: revoke whatever refresh token was presented (if any) and clear cookies.
    const raw = request.cookies?.[REFRESH_COOKIE] ?? '';
    await deps.authService.logout(raw);
    clearAuthCookies(reply);
    return reply.code(200).send({ ok: true });
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (request, reply) => {
    const { userId } = getAuth(request); // orgId/userId come ONLY from the verified JWT
    const session = await deps.authService.me(userId);
    if (!session) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    return reply.code(200).send(session);
  });
}
