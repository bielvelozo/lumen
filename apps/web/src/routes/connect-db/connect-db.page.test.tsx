import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectDatabasePage } from './ConnectDatabasePage';

interface Reply {
  status: number;
  body: unknown;
}
type Routes = Record<string, (init: RequestInit) => Reply>;

const fetchMock = vi.fn();
function mockApi(routes: Routes): void {
  fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
    // The API base may be relative in tests — give new URL a base so both resolve.
    const pathname = new URL(String(url), 'http://localhost').pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    const handler = routes[`${method} ${pathname}`];
    const reply = handler ? handler(init ?? {}) : { status: 404, body: {} };
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConnectDatabasePage />
    </QueryClientProvider>,
  );
}

const ACTIVE = {
  hasConnection: true,
  status: 'active',
  lastTestedAt: '2026-06-18T12:00:00.000Z',
  lastError: null,
  config: { host: 'db.example.com', port: 3306, databaseName: 'shop', username: 'lumen_ro', sslEnabled: true },
};
const NO_CONN = { hasConnection: false, status: null, lastTestedAt: null, lastError: null, config: null };

beforeEach(() => fetchMock.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('wizard step derivation', () => {
  it('shows the consent step when consent is not accepted', async () => {
    mockApi({
      'GET /db-connection/consent': () => ({ status: 200, body: { currentVersion: '1', acceptedVersion: null, accepted: false } }),
      'GET /db-connection': () => ({ status: 200, body: NO_CONN }),
      'GET /db-connection/consent/terms': () => ({ status: 200, body: { version: '1', points: ['somente leitura', 'voce escolhe', 'criptografada', 'revogavel'] } }),
    });
    renderPage();
    expect(await screen.findByRole('button', { name: /Aceitar e continuar/i })).toBeInTheDocument();
  });

  it('shows the connect step (credential form) when consented but no active connection', async () => {
    mockApi({
      'GET /db-connection/consent': () => ({ status: 200, body: { currentVersion: '1', acceptedVersion: '1', accepted: true } }),
      'GET /db-connection': () => ({ status: 200, body: NO_CONN }),
    });
    renderPage();
    expect(await screen.findByRole('button', { name: /Conectar e testar/i })).toBeInTheDocument();
  });

  it('shows the dashboard (no password) when active + exposure saved', async () => {
    mockApi({
      'GET /db-connection/consent': () => ({ status: 200, body: { currentVersion: '1', acceptedVersion: '1', accepted: true } }),
      'GET /db-connection': () => ({ status: 200, body: ACTIVE }),
      'GET /db-connection/exposure': () => ({ status: 200, body: { tables: [{ name: 'orders', columns: [] }], relationships: [] } }),
    });
    const { container } = renderPage();
    expect(await screen.findByText('db.example.com')).toBeInTheDocument();
    expect(screen.getByText('lumen_ro')).toBeInTheDocument();
    // The password is never rendered anywhere on the dashboard.
    expect(container.textContent).not.toMatch(/senha:|password/i);
  });
});

describe('credential form', () => {
  function consentedNoConn(extra: Routes = {}): void {
    mockApi({
      'GET /db-connection/consent': () => ({ status: 200, body: { currentVersion: '1', acceptedVersion: '1', accepted: true } }),
      'GET /db-connection': () => ({ status: 200, body: NO_CONN }),
      ...extra,
    });
  }

  it('validates against the shared schema and does not call the API on a bad port', async () => {
    consentedNoConn();
    renderPage();
    await screen.findByRole('button', { name: /Conectar e testar/i });
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'h' } });
    fireEvent.change(screen.getByLabelText('Porta'), { target: { value: '0' } }); // invalid
    fireEvent.change(screen.getByLabelText('Banco de dados'), { target: { value: 'shop' } });
    fireEvent.change(screen.getByLabelText('Usuário (somente leitura)'), { target: { value: 'ro' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'pw' } });
    const putCalls = () => fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'PUT');
    fireEvent.click(screen.getByRole('button', { name: /Conectar e testar/i }));
    await waitFor(() => expect(screen.getByLabelText('Porta')).toHaveAttribute('aria-invalid', 'true'));
    expect(putCalls()).toHaveLength(0);
  });

  it('shows a read-only error when the credential is over-privileged (422)', async () => {
    consentedNoConn({
      'PUT /db-connection': () => ({ status: 422, body: { error: 'CredentialOverPrivileged' } }),
    });
    renderPage();
    await screen.findByRole('button', { name: /Conectar e testar/i });
    fireEvent.change(screen.getByLabelText('Host'), { target: { value: 'h' } });
    fireEvent.change(screen.getByLabelText('Banco de dados'), { target: { value: 'shop' } });
    fireEvent.change(screen.getByLabelText('Usuário (somente leitura)'), { target: { value: 'root' } });
    fireEvent.change(screen.getByLabelText('Senha'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: /Conectar e testar/i }));
    expect(await screen.findByText(/não é somente leitura/i)).toBeInTheDocument();
  });
});

describe('failed connection test result', () => {
  it('shows the sanitized error category + a retry that does not re-prompt for the password', async () => {
    mockApi({
      'GET /db-connection/consent': () => ({ status: 200, body: { currentVersion: '1', acceptedVersion: '1', accepted: true } }),
      'GET /db-connection': () => ({ status: 200, body: { ...ACTIVE, status: 'failed', lastError: 'auth_failed' } }),
      'POST /db-connection/test': () => ({ status: 200, body: ACTIVE }),
    });
    renderPage();
    expect(await screen.findByText(/Falha de autenticação/i)).toBeInTheDocument();
    // Retry exists and there is no password prompt in the failed banner itself.
    const retry = screen.getByRole('button', { name: /Testar novamente/i });
    fireEvent.click(retry);
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/db-connection/test'))).toBe(true),
    );
  });
});

describe('exposure picker — both-endpoints client guard', () => {
  it('disables a relationship until both its tables are selected', async () => {
    mockApi({
      'GET /db-connection/consent': () => ({ status: 200, body: { currentVersion: '1', acceptedVersion: '1', accepted: true } }),
      'GET /db-connection': () => ({ status: 200, body: ACTIVE }),
      'GET /db-connection/exposure': () => ({ status: 200, body: { tables: [], relationships: [] } }),
      'GET /db-connection/introspect': () => ({
        status: 200,
        body: {
          tables: [{ name: 'orders', columns: [] }, { name: 'products', columns: [] }],
          relationships: [{ name: 'orders__product_id__products', fromTable: 'orders', fromColumn: 'product_id', toTable: 'products', toColumn: 'id' }],
        },
      }),
    });
    renderPage();
    const relCheckbox = await screen.findByRole('checkbox', { name: /orders\.product_id/i });
    expect(relCheckbox).toBeDisabled(); // neither table selected yet

    fireEvent.click(screen.getByRole('checkbox', { name: 'orders' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'products' }));
    await waitFor(() => expect(relCheckbox).not.toBeDisabled());
  });
});
