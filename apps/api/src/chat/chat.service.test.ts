import { describe, it, expect, vi } from 'vitest';
import { createChatService, type ChatServiceDeps } from './chat.service';
import type { ChatStore } from './chat.store';
import type { FunctionLogStore } from './function-log.store';
import type { AiConnectionStore, StoredAiConnection } from '../ai-connection/ai-connection.store';
import type { AllowListAccessor, OrgDataAccess } from '../query-registry/allow-list';
import type { QueryRunner } from '../query-registry/query-runner';
import type { ChatModelPort, ChatRunResult } from './chat-model';

const SECRET_KEY = 'sk-ant-super-secret';

const ACTIVE_AI: StoredAiConnection = {
  id: 'ai-1',
  encryptedApiKey: Buffer.from(`enc:${SECRET_KEY}`),
  defaultModel: 'claude-sonnet-4-6',
  status: 'active',
};

const access: OrgDataAccess = {
  connection: {
    connectionId: 'c1', status: 'active', host: 'db.internal', port: 3306,
    databaseName: 'shop', username: 'ro', sslEnabled: false, encryptedPassword: Buffer.from('encpw'),
  },
  allowList: { tables: new Map([['orders', new Map([['total', 'decimal']])]]), relationships: [] },
};

function makeDeps(opts: { ai?: StoredAiConnection | null; run?: ChatRunResult; access?: OrgDataAccess | null } = {}) {
  const messages: Array<{ role: string; content: string; model?: string }> = [];
  const chatStore: ChatStore = {
    createSession: vi.fn(async () => ({ id: 'sess-1' })),
    getSessionForOrg: vi.fn(async () => ({ id: 'sess-1', title: null })),
    touchSession: vi.fn(async () => undefined),
    insertUserMessage: vi.fn(async (m) => {
      messages.push({ role: 'user', content: m.content });
      return { id: 'um-1' };
    }),
    insertAssistantMessage: vi.fn(async (m) => {
      messages.push({ role: 'assistant', content: m.content, model: m.model });
      return { id: 'am-1' };
    }),
    recentMessages: vi.fn(async () => [{ role: 'user' as const, content: 'quanto vendi?' }]),
    listSessions: vi.fn(async () => []),
    getMessages: vi.fn(async () => []),
    renameSession: vi.fn(async () => true),
  };
  const logStore: FunctionLogStore = { insert: vi.fn(async () => undefined) };
  const aiConnectionStore = {
    getByOrg: vi.fn(async () => (opts.ai === undefined ? ACTIVE_AI : opts.ai)),
  } as unknown as AiConnectionStore;
  const allowListAccessor: AllowListAccessor = {
    getByOrg: vi.fn(async () => (opts.access === undefined ? access : opts.access)),
  };
  const runner: QueryRunner = { run: vi.fn(async () => []) };
  const modelPort: ChatModelPort = {
    run: vi.fn(async (_input, handlers) => {
      const result = opts.run ?? { outcome: 'answered', text: 'Você vendeu R$ 128.000 em maio.' };
      if (result.outcome === 'answered') handlers.onTextDelta(result.text);
      return result;
    }),
  };
  const decrypt = vi.fn((b: Buffer) => b.toString('utf8').replace(/^enc:/, ''));
  const deps: ChatServiceDeps = { chatStore, logStore, aiConnectionStore, allowListAccessor, runner, modelPort, decrypt };
  return { deps, chatStore, modelPort, messages };
}

const INPUT = { orgId: 'org-1', userId: 'user-1', sessionId: 'sess-1', message: 'quanto vendi em maio?' };

function collectingSink() {
  const chunks: string[] = [];
  return { sink: { onTextDelta: (d: string) => chunks.push(d) }, chunks };
}

describe('chat.service happy path', () => {
  it('persists both turns, sets title, streams the answer, returns the assistant message id', async () => {
    const { deps, chatStore, messages } = makeDeps();
    const { sink, chunks } = collectingSink();
    const res = await createChatService(deps).sendMessage(INPUT, sink);

    expect(res).toEqual({ outcome: 'answered', messageId: 'am-1', model: 'claude-sonnet-4-6' });
    expect(messages).toEqual([
      { role: 'user', content: 'quanto vendi em maio?' },
      { role: 'assistant', content: 'Você vendeu R$ 128.000 em maio.', model: 'claude-sonnet-4-6' },
    ]);
    // user message saved BEFORE the model ran; title set on first message.
    expect(chatStore.insertUserMessage).toHaveBeenCalledOnce();
    expect(chatStore.touchSession).toHaveBeenCalledWith('sess-1', 'org-1', expect.stringContaining('quanto vendi'));
    expect(chunks.join('')).toContain('128.000');
  });

  it('uses the org default model, falling back to the curated default when null', async () => {
    const { deps } = makeDeps({ ai: { ...ACTIVE_AI, defaultModel: null } });
    const { sink } = collectingSink();
    const res = await createChatService(deps).sendMessage(INPUT, sink);
    expect(res).toMatchObject({ outcome: 'answered', model: 'claude-opus-4-8' });
  });

  it('honors a per-turn model override over the org default', async () => {
    const { deps } = makeDeps();
    const { sink } = collectingSink();
    const res = await createChatService(deps).sendMessage(
      { ...INPUT, modelOverride: 'claude-haiku-4-5' },
      sink,
    );
    expect(res).toMatchObject({ outcome: 'answered', model: 'claude-haiku-4-5' });
  });

  it('the decrypted Claude key never appears in any persisted message', async () => {
    const { deps, messages } = makeDeps();
    const { sink } = collectingSink();
    await createChatService(deps).sendMessage(INPUT, sink);
    expect(JSON.stringify(messages)).not.toContain(SECRET_KEY);
  });
});

describe('chat.service unhappy paths', () => {
  it('no active AI connection → ai_not_connected (user message still saved)', async () => {
    const { deps, chatStore } = makeDeps({ ai: null });
    const { sink } = collectingSink();
    const res = await createChatService(deps).sendMessage(INPUT, sink);
    expect(res).toMatchObject({ outcome: 'error', code: 'ai_not_connected' });
    expect(chatStore.insertUserMessage).toHaveBeenCalledOnce(); // turn not lost
    expect(chatStore.insertAssistantMessage).not.toHaveBeenCalled();
  });

  it('a failed AI connection (status failed) → ai_not_connected', async () => {
    const { deps } = makeDeps({ ai: { ...ACTIVE_AI, status: 'failed' } });
    const { sink } = collectingSink();
    expect(await createChatService(deps).sendMessage(INPUT, sink)).toMatchObject({ code: 'ai_not_connected' });
  });

  it('model refusal → model_refused, no assistant message', async () => {
    const { deps, chatStore } = makeDeps({ run: { outcome: 'refusal' } });
    const { sink } = collectingSink();
    expect(await createChatService(deps).sendMessage(INPUT, sink)).toMatchObject({ code: 'model_refused' });
    expect(chatStore.insertAssistantMessage).not.toHaveBeenCalled();
  });

  it('invalid key error → ai_key_invalid', async () => {
    const { deps } = makeDeps({ run: { outcome: 'error', category: 'invalid_key' } });
    const { sink } = collectingSink();
    expect(await createChatService(deps).sendMessage(INPUT, sink)).toMatchObject({ code: 'ai_key_invalid' });
  });

  it('rate-limited error → ai_rate_limited', async () => {
    const { deps } = makeDeps({ run: { outcome: 'error', category: 'rate_limited' } });
    const { sink } = collectingSink();
    expect(await createChatService(deps).sendMessage(INPUT, sink)).toMatchObject({ code: 'ai_rate_limited' });
  });

  it('step limit → step_limit', async () => {
    const { deps } = makeDeps({ run: { outcome: 'step_limit' } });
    const { sink } = collectingSink();
    expect(await createChatService(deps).sendMessage(INPUT, sink)).toMatchObject({ code: 'step_limit' });
  });
});
