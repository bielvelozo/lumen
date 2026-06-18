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
