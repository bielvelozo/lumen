import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { AuthenticatedUser } from '@lumen/shared';
import type { AccessTokenService } from './jwt';
import { ACCESS_COOKIE } from './cookies';

// Augment the request with the verified caller identity. This is the ONLY place a
// handler may learn the tenant — `request.auth.orgId` comes from the signed JWT claims,
// never from the body/query/path/header (constitution invariant 1, anti-IDOR).
declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthenticatedUser;
  }
}

/**
 * Build the `requireAuth` preHandler. It reads the access JWT from the httpOnly cookie,
 * verifies it, and on success attaches `{ userId, orgId }` to the request. Any
 * missing/invalid/expired token short-circuits with `401`. Protected routes opt in by
 * registering this as a `preHandler`; it is the single sanctioned authentication seam.
 */
export function makeRequireAuth(accessTokenService: AccessTokenService): preHandlerHookHandler {
  return async function requireAuth(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const token = request.cookies?.[ACCESS_COOKIE];
    const claims = token ? await accessTokenService.verify(token) : null;
    if (!claims) {
      await reply.code(401).send({ error: 'Unauthorized' });
      return;
    }
    request.auth = claims;
  };
}

/**
 * The ONLY sanctioned accessor of the authenticated caller. Returns the verified
 * `{ userId, orgId }`. Throws if called on a route that did not run `requireAuth` — a
 * programming error, never a path that silently falls back to a client-supplied id.
 */
export function getAuth(request: FastifyRequest): AuthenticatedUser {
  if (!request.auth) {
    throw new Error('getAuth() requires a requireAuth-guarded route — orgId must come from the JWT');
  }
  return request.auth;
}
