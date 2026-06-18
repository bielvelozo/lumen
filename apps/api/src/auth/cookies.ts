import type { FastifyReply } from 'fastify';
import type { CookieSerializeOptions } from '@fastify/cookie';

/**
 * Auth cookie names + attributes, centralized so spec 16 only swaps domain/origin — never
 * the security flags. Both cookies are `httpOnly` (never readable by JS), `Secure`, and
 * `SameSite=None` (the SPA and API are cross-origin in prod). The refresh cookie is
 * scoped to `Path=/auth` so the browser only sends it to the auth endpoints that need it
 * (least surface); the access cookie is `Path=/` so every API call carries it.
 *
 * NOTE: `Secure` + `SameSite=None` means browsers reject these cookies over plain HTTP —
 * local dev needs TLS or a browser exception (recorded LIVE-VERIFICATION-PENDING).
 */
export const ACCESS_COOKIE = 'lumen_access';
export const REFRESH_COOKIE = 'lumen_refresh';

const accessCookieOptions: CookieSerializeOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'none',
  path: '/',
};

const refreshCookieOptions: CookieSerializeOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'none',
  path: '/auth',
};

export interface AuthCookies {
  accessToken: string;
  accessMaxAgeSeconds: number;
  refreshToken: string;
  refreshMaxAgeSeconds: number;
}

/** Set the access + refresh cookies with their max-ages aligned to the token TTLs. */
export function setAuthCookies(reply: FastifyReply, tokens: AuthCookies): void {
  reply.setCookie(ACCESS_COOKIE, tokens.accessToken, {
    ...accessCookieOptions,
    maxAge: tokens.accessMaxAgeSeconds,
  });
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...refreshCookieOptions,
    maxAge: tokens.refreshMaxAgeSeconds,
  });
}

/** Clear both auth cookies (logout). Uses the same attributes/paths so the browser matches. */
export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, accessCookieOptions);
  reply.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
}
