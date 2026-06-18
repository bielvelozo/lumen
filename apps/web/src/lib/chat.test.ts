import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ChatStreamEvent } from '@lumen/shared';
import { listSessions, createSession, renameSession, streamMessage } from './chat';

const fetchMock = vi.fn();
beforeEach(() => fetchMock.mockReset());
afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function sseResponse(frames: string[]) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('anti-IDOR: no chat request carries an org_id', () => {
  it('list / create / rename send no org_id and always credentials:include', async () => {
    fetchMock.mockImplementation(async () => jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await listSessions();
    await createSession();
    await renameSession('s1', 'Vendas Q2');
    for (const call of fetchMock.mock.calls) {
      const url = String(call[0]);
      const init = (call[1] ?? {}) as RequestInit;
      expect(`${url} ${typeof init.body === 'string' ? init.body : ''}`).not.toMatch(/org_id|orgId/i);
      expect(init.credentials).toBe('include');
    }
  });
});

describe('streamMessage — SSE reader', () => {
  it('parses text-delta frames then a terminal done, and sends no org_id', async () => {
    fetchMock.mockImplementation(async () =>
      sseResponse([
        'data: {"type":"text-delta","delta":"Você vendeu "}\n\n',
        'data: {"type":"text-delta","delta":"R$ 128.000."}\n\n',
        'data: {"type":"done","messageId":"am-1","model":"claude-opus-4-8"}\n\n',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const events: ChatStreamEvent[] = [];
    for await (const e of streamMessage('s1', { message: 'quanto vendi?' })) events.push(e);

    expect(events).toEqual([
      { type: 'text-delta', delta: 'Você vendeu ' },
      { type: 'text-delta', delta: 'R$ 128.000.' },
      { type: 'done', messageId: 'am-1', model: 'claude-opus-4-8' },
    ]);
    const body = String((fetchMock.mock.calls[0]?.[1] as RequestInit).body);
    expect(body).not.toMatch(/org_id|orgId/i);
    expect(JSON.parse(body)).toEqual({ message: 'quanto vendi?' });
  });

  it('handles frames split across chunk boundaries', async () => {
    fetchMock.mockImplementation(async () =>
      sseResponse(['data: {"type":"text-', 'delta","delta":"oi"}\n\n', 'data: {"type":"done","messageId":"m","model":"claude-opus-4-8"}\n\n']),
    );
    vi.stubGlobal('fetch', fetchMock);
    const events: ChatStreamEvent[] = [];
    for await (const e of streamMessage('s1', { message: 'oi' })) events.push(e);
    expect(events[0]).toEqual({ type: 'text-delta', delta: 'oi' });
    expect(events.at(-1)).toMatchObject({ type: 'done' });
  });

  it('yields a terminal error event when the response is not ok', async () => {
    fetchMock.mockImplementation(async () => new Response('nope', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const events: ChatStreamEvent[] = [];
    for await (const e of streamMessage('s1', { message: 'x' })) events.push(e);
    expect(events).toEqual([{ type: 'error', code: 'unknown', message: expect.any(String) }]);
  });
});
