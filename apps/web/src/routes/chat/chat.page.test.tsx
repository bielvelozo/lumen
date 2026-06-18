import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { renderRoutes, TEST_SESSION } from '../../test-utils';

interface Reply {
  status: number;
  body: unknown;
}
type Handler = (init: RequestInit) => Reply;

const fetchMock = vi.fn();

const DB_ACTIVE = {
  hasConnection: true,
  status: 'active',
  lastTestedAt: 't',
  lastError: null,
  config: { host: 'h', port: 3306, databaseName: 'd', username: 'u', sslEnabled: true },
};
const AI_ACTIVE = {
  provider: 'claude',
  hasKey: true,
  defaultModel: 'claude-sonnet-4-6',
  status: 'active',
  lastValidatedAt: 't',
  lastError: null,
};
const AI_INACTIVE = { ...AI_ACTIVE, hasKey: false, defaultModel: null, status: null };

const SESSIONS = [
  { id: 's2', title: 'Vendas Q2', updatedAt: '2026-06-18T12:00:00.000Z' },
  { id: 's1', title: 'Conversa antiga', updatedAt: '2026-06-17T12:00:00.000Z' },
];

function sse(frames: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function mockApi(routes: Record<string, Handler>, opts: { stream?: string[] } = {}): void {
  fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
    const u = new URL(String(url), 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${u.pathname}`;
    // The streaming send returns SSE, not JSON.
    if (method === 'POST' && /\/chat\/sessions\/[^/]+\/messages$/.test(u.pathname)) {
      return sse(opts.stream ?? ['data: {"type":"done","messageId":"am","model":"claude-sonnet-4-6"}\n\n']);
    }
    const handler = routes[key] ?? routes[`${method} ${u.pathname.replace(/\/s\d+/, '/:id')}`];
    const reply = handler ? handler(init ?? {}) : { status: 404, body: {} };
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
}

const READY = {
  'GET /db-connection': () => ({ status: 200, body: DB_ACTIVE }),
  'GET /ai-connection': () => ({ status: 200, body: AI_ACTIVE }),
  'GET /chat/sessions': () => ({ status: 200, body: SESSIONS }),
};

beforeEach(() => fetchMock.mockReset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('sessions sidebar', () => {
  it('renders the caller\'s sessions in server (updated_at desc) order', async () => {
    mockApi({ ...READY, 'GET /chat/sessions/:id/messages': () => ({ status: 200, body: [] }) });
    renderRoutes({ initialEntries: ['/chat'], session: TEST_SESSION });
    const nav = await screen.findByRole('navigation', { name: 'Conversas' });
    await within(nav).findByRole('button', { name: 'Vendas Q2' });
    const text = nav.textContent ?? '';
    expect(text.indexOf('Vendas Q2')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Vendas Q2')).toBeLessThan(text.indexOf('Conversa antiga')); // server order preserved
  });
});

describe('conversation', () => {
  it('loads a session\'s messages on solid bubbles', async () => {
    mockApi({
      ...READY,
      'GET /chat/sessions/:id/messages': () => ({
        status: 200,
        body: [
          { id: 'm1', role: 'user', content: 'quanto vendi em maio?', model: null, createdAt: 't' },
          { id: 'm2', role: 'assistant', content: 'Você vendeu R$ 128.000.', model: 'claude-sonnet-4-6', createdAt: 't' },
        ],
      }),
    });
    const { container } = renderRoutes({ initialEntries: ['/chat/s2'], session: TEST_SESSION });
    expect(await screen.findByText('Você vendeu R$ 128.000.')).toBeInTheDocument();
    // The answer is on a solid .bubble, never under .glass.
    expect(container.querySelector('.glass .bubble')).toBeNull();
  });

  it('send → streamed assistant answer → settle into canonical messages', async () => {
    let sent = false;
    fetchMock.mockImplementation(async (url: unknown, init?: RequestInit) => {
      const u = new URL(String(url), 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'POST' && /\/messages$/.test(u.pathname)) {
        sent = true;
        return sse([
          'data: {"type":"text-delta","delta":"Você vendeu R$ 350."}\n\n',
          'data: {"type":"done","messageId":"am","model":"claude-sonnet-4-6"}\n\n',
        ]);
      }
      const body =
        u.pathname === '/db-connection'
          ? DB_ACTIVE
          : u.pathname === '/ai-connection'
            ? AI_ACTIVE
            : u.pathname === '/chat/sessions'
              ? SESSIONS
              : /\/messages$/.test(u.pathname)
                ? sent
                  ? [
                      { id: 'm1', role: 'user', content: 'quanto vendi em maio?', model: null, createdAt: 't' },
                      { id: 'm2', role: 'assistant', content: 'Você vendeu R$ 350.', model: 'claude-sonnet-4-6', createdAt: 't' },
                    ]
                  : []
                : {};
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderRoutes({ initialEntries: ['/chat/s2'], session: TEST_SESSION });
    const input = await screen.findByLabelText('Mensagem');
    fireEvent.change(input, { target: { value: 'quanto vendi em maio?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));

    // The streamed/canonical assistant answer and the user question both render (on solid bubbles).
    await waitFor(() => expect(screen.getByText('Você vendeu R$ 350.')).toBeInTheDocument());
    expect(screen.getByText('quanto vendi em maio?')).toBeInTheDocument();
  });

  it('gates the input behind connection readiness (AI not connected → CTA to /connect/ai)', async () => {
    mockApi({
      'GET /db-connection': () => ({ status: 200, body: DB_ACTIVE }),
      'GET /ai-connection': () => ({ status: 200, body: AI_INACTIVE }),
      'GET /chat/sessions': () => ({ status: 200, body: [] }),
      'GET /chat/sessions/:id/messages': () => ({ status: 200, body: [] }),
    });
    renderRoutes({ initialEntries: ['/chat'], session: TEST_SESSION });
    expect(await screen.findByRole('link', { name: /Conectar IA/i })).toHaveAttribute('href', '/connect/ai');
    expect(screen.queryByLabelText('Mensagem')).toBeNull(); // no doomed input
  });

  it('the model switcher defaults to the org default_model', async () => {
    mockApi({ ...READY, 'GET /chat/sessions/:id/messages': () => ({ status: 200, body: [] }) });
    renderRoutes({ initialEntries: ['/chat/s2'], session: TEST_SESSION });
    await screen.findByLabelText('Modelo');
    await waitFor(() =>
      expect((screen.getByLabelText('Modelo') as HTMLSelectElement).value).toBe('claude-sonnet-4-6'),
    );
  });
});

describe('glass-only-on-chrome (RALPH 06/10/14 guard)', () => {
  it('no bubble/card/metric/answer renders under .glass; the sidebar + input are glass', async () => {
    mockApi({
      ...READY,
      'GET /chat/sessions/:id/messages': () => ({
        status: 200,
        body: [{ id: 'm1', role: 'assistant', content: 'R$ 128.000', model: 'claude-sonnet-4-6', createdAt: 't' }],
      }),
    });
    const { container } = renderRoutes({ initialEntries: ['/chat/s2'], session: TEST_SESSION });
    await screen.findByText('R$ 128.000');

    // chrome (shell sidebar/topbar + chat sidebar + input) IS glass.
    expect(container.querySelectorAll('.glass').length).toBeGreaterThanOrEqual(2);
    // NO data surface is a descendant of glass.
    expect(container.querySelectorAll('.glass .bubble, .glass .card, .glass .metric')).toHaveLength(0);
    // The figure is not on glass.
    expect(screen.getByText('R$ 128.000').closest('.glass')).toBeNull();
  });
});
