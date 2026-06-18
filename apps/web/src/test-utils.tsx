import { render, type RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SessionResponse } from '@lumen/shared';
import { ThemeProvider } from './design-system/ui';
import { ME_QUERY_KEY } from './lib/query-client';
import { AppRoutes } from './router';

/** A QueryClient for tests: no retry, never stale/gc'd, so seeded data never triggers a refetch. */
export function makeTestClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

interface RenderRoutesOptions {
  initialEntries?: string[];
  /** Seed the `me` query: a session (authed), `null` (logged out), or omit to leave it pending. */
  session?: SessionResponse | null;
  client?: QueryClient;
}

export function renderRoutes(
  options: RenderRoutesOptions = {},
): RenderResult & { client: QueryClient } {
  const client = options.client ?? makeTestClient();
  if (options.session !== undefined) {
    client.setQueryData(ME_QUERY_KEY, options.session);
  }
  const result = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MemoryRouter initialEntries={options.initialEntries ?? ['/']}>
          <AppRoutes />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...result, client };
}

export const TEST_SESSION: SessionResponse = {
  userId: '11111111-1111-1111-1111-111111111111',
  orgId: '22222222-2222-2222-2222-222222222222',
  email: 'owner@example.com',
};
