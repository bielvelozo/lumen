import type {
  ChatSessionSummary,
  ChatMessageDTO,
  CreateChatSessionResponse,
  ChatStreamEvent,
  ClaudeModelId,
} from '@lumen/shared';
import { apiFetch, apiUrl } from './api-client';

/**
 * Flow-4 endpoints (spec 13/14). Non-stream reads/mutations go through `apiFetch` (cookie auth,
 * no `org_id` ever). The live answer is a streaming POST consumed below. The client sends only a
 * `session_id` in the path — never a tenant id; the backend re-scopes by the JWT org.
 */
export const listSessions = (): Promise<ChatSessionSummary[]> => apiFetch('/chat/sessions');

export const getMessages = (sessionId: string): Promise<ChatMessageDTO[]> =>
  apiFetch(`/chat/sessions/${sessionId}/messages`);

export const createSession = (): Promise<CreateChatSessionResponse> =>
  apiFetch('/chat/sessions', { method: 'POST' });

export const renameSession = (sessionId: string, title: string): Promise<{ ok: boolean }> =>
  apiFetch(`/chat/sessions/${sessionId}`, { method: 'PATCH', body: { title } });

/**
 * Stream an assistant answer. POSTs the message (cookie auth, no `org_id`) and yields each
 * SSE `data:` JSON event (`text-delta`* then exactly one `done`|`error`). An `AbortSignal`
 * cancels the in-flight stream (the stop control); a discarded partial is never persisted.
 */
export async function* streamMessage(
  sessionId: string,
  body: { message: string; model?: ClaudeModelId },
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const response = await fetch(apiUrl(`/chat/sessions/${sessionId}/messages`), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    yield { type: 'error', code: 'unknown', message: 'Não foi possível iniciar a resposta.' };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE frames are separated by a blank line.
    let sep = buffer.indexOf('\n\n');
    while (sep !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (line) {
        try {
          yield JSON.parse(line.slice('data: '.length)) as ChatStreamEvent;
        } catch {
          /* ignore a malformed frame */
        }
      }
      sep = buffer.indexOf('\n\n');
    }
  }
}
