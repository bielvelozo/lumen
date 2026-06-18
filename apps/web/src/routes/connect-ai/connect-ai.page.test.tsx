import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConnectAiPage } from './ConnectAiPage';

interface Reply {
  status: number;
  body: unknown;
}
type Routes = Record<string, (init: RequestInit) => Reply>;

const fetchMock = vi.fn();
function mockApi(routes: Routes): void {
  fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
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
      <ConnectAiPage />
    </QueryClientProvider>,
  );
}

const EMPTY = { provider: 'claude', hasKey: false, defaultModel: null, status: null, lastValidatedAt: null, lastError: null };
const ACTIVE = {
  provider: 'claude',
  hasKey: true,
  defaultModel: 'claude-opus-4-8',
  status: 'active',
  lastValidatedAt: '2026-06-18T12:00:00.000Z',
  lastError: null,
};

beforeEach(() => fetchMock.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ConnectAiPage', () => {
  it('offers the curated models and a write-only (masked) key field', async () => {
    mockApi({ 'GET /ai-connection': () => ({ status: 200, body: EMPTY }) });
    renderPage();
    const keyField = await screen.findByLabelText('Chave da Anthropic');
    expect(keyField).toHaveAttribute('type', 'password');
    // The curated list (and only it) drives the selector.
    expect(screen.getByRole('option', { name: 'Claude Opus 4.8' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Claude Sonnet 4.6' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Claude Haiku 4.5' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /4\.7/ })).toBeNull();
  });

  it('sends the pasted key once, never carries an org_id, and clears the field after', async () => {
    const SECRET = 'sk-ant-secret-key-value';
    let connected = false;
    mockApi({
      'GET /ai-connection': () => ({ status: 200, body: connected ? ACTIVE : EMPTY }),
      'PUT /ai-connection': () => {
        connected = true;
        return { status: 200, body: { state: ACTIVE, error: null } };
      },
    });
    renderPage();
    const keyField = await screen.findByLabelText('Chave da Anthropic');
    fireEvent.change(keyField, { target: { value: SECRET } });
    fireEvent.click(screen.getByRole('button', { name: /Conectar e validar/i }));

    await waitFor(() => expect(screen.getByText(/Conectado/)).toBeInTheDocument());

    const put = fetchMock.mock.calls.find((c) => (c[1] as RequestInit)?.method === 'PUT');
    expect(put).toBeDefined();
    const body = String((put?.[1] as RequestInit).body);
    expect(JSON.parse(body)).toEqual({ apiKey: SECRET, model: 'claude-opus-4-8' });
    expect(body).not.toMatch(/org_id|orgId/i);
    // The field is cleared after submit (write-only, never retained/echoed).
    await waitFor(() => expect(screen.getByLabelText(/Nova chave/i)).toHaveValue(''));
  });

  it('shows a sanitized category message on a rejected key (and never the key)', async () => {
    mockApi({
      'GET /ai-connection': () => ({ status: 200, body: EMPTY }),
      'PUT /ai-connection': () => ({ status: 200, body: { state: EMPTY, error: 'invalid_key' } }),
    });
    const { container } = renderPage();
    const keyField = await screen.findByLabelText('Chave da Anthropic');
    fireEvent.change(keyField, { target: { value: 'sk-ant-bad' } });
    fireEvent.click(screen.getByRole('button', { name: /Conectar e validar/i }));
    expect(await screen.findByText(/rejeitada pela Anthropic/i)).toBeInTheDocument();
    expect(container.textContent).not.toContain('sk-ant-bad');
  });

  it('does not display the key when already configured (dashboard never shows it)', async () => {
    mockApi({ 'GET /ai-connection': () => ({ status: 200, body: ACTIVE }) });
    const { container } = renderPage();
    await screen.findByText(/Conectado/);
    // The masked re-key field is empty; nothing renders the secret.
    expect(screen.getByLabelText(/Nova chave/i)).toHaveValue('');
    expect(container.textContent).not.toMatch(/sk-ant/);
  });
});
