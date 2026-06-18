import { useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider, AppBackground } from './design-system/ui';
import { createQueryClient } from './lib/query-client';
import { AppRoutes } from './router';

/**
 * App root: composes the global providers once. The `QueryClient` is created lazily and
 * held stable across renders (react-best-practices). `<AppBackground/>` renders a single
 * time at the root so the chrome's glass has something to refract.
 */
export function App(): JSX.Element {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AppBackground />
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
