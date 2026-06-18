import { describe, it, expect, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { createAccessTokenService } from '../auth/jwt';
import { ACCESS_COOKIE } from '../auth/cookies';
import type { ChatService } from './chat.service';
import type { ChatStore } from './chat.store';

const SECRET = 'chat-route-test-secret-at-least-32bytes!';
const accessTokens = createAccessTokenService({ secret: SECRET, ttlSeconds: 900 });
const ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER = '11111111-1111-1111-1111-111111111111';
const OWNED = 'sess-owned';
const OTHER_ORG_SESSION = 'sess-other';

function buildChatApp(opts: { sendMessage?: ChatService['sendMessage'] } = {}) {
  const sendMessage = vi.fn(
    opts.sendMessage ??
      (async (_input, sink) => {
        sink.onTextDelta('Você vendeu ');
        sink.onTextDelta('R$ 128.000.');
        return { outcome: 'answered' as const, messageId: 'am-1', model: 'claude-opus-4-8' };
      }),
  );
  const service: ChatService = { sendMessage };
  const chatStore = {
    createSession: vi.fn(async () => ({ id: 'new-session' })),
    // OWNED resolves for this org; anything else (another org's session) resolves to null.
    getSessionForOrg: vi.fn(async (sessionId: string, orgId: string) =>
      sessionId === OWNED && orgId === ORG ? { id: OWNED, title: null } : null,
    ),
    listSessions: vi.fn(async (orgId: string) =>
      orgId === ORG
        ? [
            { id: 's2', title: 'Vendas Q2', updatedAt: '2026-06-18T12:00:00.000Z' },
            { id: 's1', title: 'Nova conversa', updatedAt: '2026-06-17T12:00:00.000Z' },
          ]
        : [],
    ),
    getMessages: vi.fn(async (sessionId: string, orgId: string) =>
      sessionId === OWNED && orgId === ORG
        ? [{ id: 'm1', role: 'user' as const, content: 'oi', model: null, createdAt: '2026-06-18T12:00:00.000Z' }]
        : null,
    ),
    renameSession: vi.fn(async (sessionId: string, orgId: string) => sessionId === OWNED && orgId === ORG),
  } as unknown as ChatStore;
  const app = buildApp({ chat: { service, chatStore, accessTokenService: accessTokens } });
  return { app, sendMessage, chatStore };
}

async function cookie(): Promise<Record<string, string>> {
  return { [ACCESS_COOKIE]: await accessTokens.sign({ userId: USER, orgId: ORG }) };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('POST /chat/sessions', () => {
  it('401s without auth; creates with the JWT org/user otherwise', async () => {
    const built = buildChatApp();
    app = built.app;
    expect((await app.inject({ method: 'POST', url: '/chat/sessions' })).statusCode).toBe(401);
    const res = await app.inject({ method: 'POST', url: '/chat/sessions', cookies: await cookie() });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ id: 'new-session' });
  });
});

describe('GET /chat/sessions', () => {
  it('401s without auth; returns the caller\'s sessions (updated_at desc) otherwise', async () => {
    const built = buildChatApp();
    app = built.app;
    expect((await app.inject({ method: 'GET', url: '/chat/sessions' })).statusCode).toBe(401);
    const res = await app.inject({ method: 'GET', url: '/chat/sessions', cookies: await cookie() });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<{ id: string }>;
    expect(list.map((s) => s.id)).toEqual(['s2', 's1']); // server order preserved
  });
});

describe('GET /chat/sessions/:id/messages', () => {
  it('returns history for an owned session; 404 for another org\'s session', async () => {
    ({ app } = buildChatApp());
    const ok = await app.inject({ method: 'GET', url: `/chat/sessions/${OWNED}/messages`, cookies: await cookie() });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as unknown[]).length).toBe(1);
    const other = await app.inject({ method: 'GET', url: `/chat/sessions/${OTHER_ORG_SESSION}/messages`, cookies: await cookie() });
    expect(other.statusCode).toBe(404);
  });
});

describe('PATCH /chat/sessions/:id', () => {
  it('renames an owned session; 404 cross-tenant; 400 on empty title', async () => {
    ({ app } = buildChatApp());
    const ok = await app.inject({ method: 'PATCH', url: `/chat/sessions/${OWNED}`, cookies: await cookie(), payload: { title: 'Vendas Q2' } });
    expect(ok.statusCode).toBe(200);
    const cross = await app.inject({ method: 'PATCH', url: `/chat/sessions/${OTHER_ORG_SESSION}`, cookies: await cookie(), payload: { title: 'x' } });
    expect(cross.statusCode).toBe(404);
    const bad = await app.inject({ method: 'PATCH', url: `/chat/sessions/${OWNED}`, cookies: await cookie(), payload: { title: '' } });
    expect(bad.statusCode).toBe(400);
  });
});

describe('POST /chat/sessions/:sessionId/messages', () => {
  it('401s without auth', async () => {
    ({ app } = buildChatApp());
    const res = await app.inject({ method: 'POST', url: `/chat/sessions/${OWNED}/messages`, payload: { message: 'hi' } });
    expect(res.statusCode).toBe(401);
  });

  it('400 on an empty message', async () => {
    ({ app } = buildChatApp());
    const res = await app.inject({
      method: 'POST',
      url: `/chat/sessions/${OWNED}/messages`,
      cookies: await cookie(),
      payload: { message: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('cross-tenant: another org\'s sessionId → 404 and the orchestrator is never called', async () => {
    const built = buildChatApp();
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: `/chat/sessions/${OTHER_ORG_SESSION}/messages`,
      cookies: await cookie(),
      payload: { message: 'quanto vendi?' },
    });
    expect(res.statusCode).toBe(404);
    expect(built.sendMessage).not.toHaveBeenCalled(); // nothing cross-tenant loaded
  });

  it('streams text-delta events then a terminal done event (SSE contract)', async () => {
    const built = buildChatApp();
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: `/chat/sessions/${OWNED}/messages`,
      cookies: await cookie(),
      payload: { message: 'quanto vendi em maio?' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = res.payload
      .split('\n\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice('data: '.length)));
    expect(events.filter((e) => e.type === 'text-delta')).toHaveLength(2);
    expect(events.at(-1)).toEqual({ type: 'done', messageId: 'am-1', model: 'claude-opus-4-8' });
    expect(built.sendMessage.mock.calls[0]?.[0]).toMatchObject({ orgId: ORG, userId: USER, sessionId: OWNED });
  });

  it('streams a terminal error event when the orchestrator returns an error', async () => {
    ({ app } = buildChatApp({
      sendMessage: async () => ({ outcome: 'error', code: 'ai_not_connected', message: 'Conecte sua chave.' }),
    }));
    const res = await app.inject({
      method: 'POST',
      url: `/chat/sessions/${OWNED}/messages`,
      cookies: await cookie(),
      payload: { message: 'oi' },
    });
    expect(res.statusCode).toBe(200);
    const last = res.payload
      .split('\n\n')
      .filter((l) => l.startsWith('data: '))
      .map((l) => JSON.parse(l.slice('data: '.length)))
      .at(-1);
    expect(last).toMatchObject({ type: 'error', code: 'ai_not_connected' });
  });
});
