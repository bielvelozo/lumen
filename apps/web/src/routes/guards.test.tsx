import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { renderRoutes, TEST_SESSION } from '../test-utils';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('route guards', () => {
  it('redirects an unauthenticated visitor from a protected route to /login', async () => {
    renderRoutes({ initialEntries: ['/'], session: null });
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('admits an authenticated visitor to the protected home', async () => {
    renderRoutes({ initialEntries: ['/'], session: TEST_SESSION });
    expect(await screen.findByText('Bem-vindo ao Lumen')).toBeInTheDocument();
  });

  it('bounces an authenticated visitor away from a public auth route to home', async () => {
    renderRoutes({ initialEntries: ['/login'], session: TEST_SESSION });
    expect(await screen.findByText('Bem-vindo ao Lumen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entrar' })).not.toBeInTheDocument();
  });

  it('shows a splash (not a flash of login or content) while bootstrap is pending', async () => {
    // Leave the me query pending by never resolving fetch.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    renderRoutes({ initialEntries: ['/'] }); // no seeded session -> queryFn runs, stays pending
    await waitFor(() => expect(screen.getByLabelText('Carregando')).toBeInTheDocument());
    expect(screen.queryByText('Bem-vindo ao Lumen')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entrar' })).not.toBeInTheDocument();
  });
});
