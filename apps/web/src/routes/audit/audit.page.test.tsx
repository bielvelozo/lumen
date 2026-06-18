import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuditPage } from './AuditPage';
import { ErrorBoundary } from '../../observability/ErrorBoundary';

const fetchMock = vi.fn();
beforeEach(() => fetchMock.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuditPage />
    </QueryClientProvider>,
  );
}

const PAGE = {
  items: [
    {
      id: 'log-1',
      functionName: 'aggregate_over_time',
      status: 'success',
      durationMs: 12,
      provider: 'claude',
      model: 'claude-opus-4-8',
      params: { table: 'string' },
      errorMessage: null,
      createdAt: '2026-06-18T12:00:00.000Z',
    },
  ],
  page: 1,
  hasMore: false,
};

describe('AuditPage', () => {
  it('renders the audit rows on solid Card surfaces (never glass) and sends no org_id', async () => {
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify(PAGE), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { container } = renderPage();
    expect(await screen.findByText('aggregate_over_time')).toBeInTheDocument();
    // Audit data sits on .card (solid), never under .glass.
    expect(container.querySelector('.glass')).toBeNull();
    expect(container.querySelector('.card')).not.toBeNull();
    // The request carries no org_id; credentials are included.
    const call = fetchMock.mock.calls[0];
    expect(String(call?.[0])).not.toMatch(/org_id|orgId/i);
    expect((call?.[1] as RequestInit).credentials).toBe('include');
  });

  it('shows an empty state when there are no logs', async () => {
    fetchMock.mockImplementation(async () =>
      new Response(JSON.stringify({ items: [], page: 1, hasMore: false }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderPage();
    expect(await screen.findByText(/Nenhuma consulta registrada/i)).toBeInTheDocument();
  });
});

function Boom(): JSX.Element {
  throw new Error('render exploded');
}

describe('ErrorBoundary', () => {
  it('renders a calm solid fallback (not raw error text) when a child throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Algo deu errado')).toBeInTheDocument();
    expect(screen.queryByText('render exploded')).toBeNull(); // raw error not shown
    spy.mockRestore();
  });
});
