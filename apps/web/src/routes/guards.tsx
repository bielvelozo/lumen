import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../lib/session';
import { Splash } from './Splash';

/** Clamp a `from` redirect target to a same-origin in-app path (no open-redirect). */
export function safeFrom(from: string | null): string {
  if (!from) return '/';
  // Only allow internal absolute paths like "/foo"; reject "//host", "http://", etc.
  if (from.startsWith('/') && !from.startsWith('//')) return from;
  return '/';
}

/**
 * Protected-zone guard. Bootstraps via `useSession` (`GET /auth/me`):
 *  - pending  → splash (never a flash of login/protected content)
 *  - session  → render the protected tree (`<Outlet/>`)
 *  - null/err → redirect to `/login?from=<attempted path>`
 */
export function RequireAuth(): JSX.Element {
  const { data: session, isPending } = useSession();
  const location = useLocation();

  if (isPending) return <Splash />;
  if (session) return <Outlet />;

  const from = encodeURIComponent(location.pathname + location.search);
  return <Navigate to={`/login?from=${from}`} replace />;
}

/**
 * Public-zone guard for the auth pages. An already-authenticated visitor is bounced to the
 * app (honoring a safe `?from=`); while pending shows the splash; otherwise renders the
 * public page.
 */
export function PublicOnly(): JSX.Element {
  const { data: session, isPending } = useSession();
  const location = useLocation();

  if (isPending) return <Splash />;
  if (session) {
    const from = new URLSearchParams(location.search).get('from');
    return <Navigate to={safeFrom(from)} replace />;
  }
  return <Outlet />;
}
