import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { SessionResponse } from '@lumen/shared';
import { fetchMe } from './api';
import { ApiError } from './api-client';
import { ME_QUERY_KEY } from './query-client';

/**
 * Bootstrap the session from the server (the httpOnly cookie is unreadable by JS, so this
 * is the single source of truth). Resolves to the session on `200`, or `null` on `401`
 * (logged out) — a `401` is a state, not an error, so the guard can branch cleanly. While
 * pending, callers show a splash, never a flash of login/protected content.
 */
export function useSession(): UseQueryResult<SessionResponse | null> {
  return useQuery<SessionResponse | null>({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => {
      try {
        return await fetchMe();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
  });
}
