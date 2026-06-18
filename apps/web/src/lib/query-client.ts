import { QueryClient, QueryCache, MutationCache } from '@tanstack/react-query';
import { ApiError } from './api-client';

export const ME_QUERY_KEY = ['me'] as const;

/**
 * Build the app's single QueryClient. A global `401` anywhere (a query or mutation) means
 * the session is gone: clear the `me` cache so the route guard redirects to `/login`,
 * rather than surfacing a thrown error toast. Conservative defaults avoid refetch storms
 * (`react-best-practices`): no retry, no refetch-on-focus, a short `staleTime`.
 */
export function createQueryClient(): QueryClient {
  // The caches' onError must reach the client to clear the `me` cache; a ref holder keeps
  // `client` a single-assignment const without a circular initializer.
  const ref: { client: QueryClient | null } = { client: null };

  const handleError = (error: unknown): void => {
    if (error instanceof ApiError && error.status === 401) {
      ref.client?.setQueryData(ME_QUERY_KEY, null);
    }
  };

  const client = new QueryClient({
    queryCache: new QueryCache({ onError: handleError }),
    mutationCache: new MutationCache({ onError: handleError }),
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false, staleTime: 60_000 },
      mutations: { retry: false },
    },
  });

  ref.client = client;
  return client;
}
