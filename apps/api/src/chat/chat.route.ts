import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { sendMessageRequestSchema, renameSessionRequestSchema, type ChatStreamEvent } from '@lumen/shared';
import { getAuth } from '../auth/require-auth';
import { validationErrorBody } from '../auth/http-validation';
import type { ChatService } from './chat.service';
import type { ChatStore } from './chat.store';
import { CHAT_ERROR_MESSAGES } from './sanitize';

export interface ChatRouteDeps {
  service: ChatService;
  chatStore: ChatStore;
}

/**
 * Chat routes (all `requireAuth`). `org_id`/`user_id` come ONLY from the JWT via `getAuth`; the
 * body never carries an id. A `:sessionId` is validated to belong to the caller's org — a
 * session owned by another org returns 404 (don't confirm existence). The messages route streams
 * the answer as SSE `data:` JSON events (the contract spec 14 consumes).
 */
export function registerChatRoutes(
  app: FastifyInstance,
  deps: ChatRouteDeps,
  requireAuth: preHandlerHookHandler,
): void {
  app.post('/chat/sessions', { preHandler: requireAuth }, async (request, reply) => {
    const { orgId, userId } = getAuth(request);
    const { id } = await deps.chatStore.createSession({ orgId, userId, title: null });
    return reply.code(201).send({ id });
  });

  // The caller's sessions, updated_at desc (org-scoped).
  app.get('/chat/sessions', { preHandler: requireAuth }, async (request, reply) => {
    const { orgId } = getAuth(request);
    return reply.code(200).send(await deps.chatStore.listSessions(orgId));
  });

  // A session's message history. A session that isn't the caller's → 404 (no existence leak).
  app.get('/chat/sessions/:sessionId/messages', { preHandler: requireAuth }, async (request, reply) => {
    const { orgId } = getAuth(request);
    const { sessionId } = request.params as { sessionId: string };
    const history = await deps.chatStore.getMessages(sessionId, orgId);
    if (history === null) return reply.code(404).send({ error: 'NotFound' });
    return reply.code(200).send(history);
  });

  // Rename a session. A session that isn't the caller's → 404.
  app.patch('/chat/sessions/:sessionId', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = renameSessionRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(validationErrorBody(parsed.error));
    const { orgId } = getAuth(request);
    const { sessionId } = request.params as { sessionId: string };
    const ok = await deps.chatStore.renameSession(sessionId, orgId, parsed.data.title);
    if (!ok) return reply.code(404).send({ error: 'NotFound' });
    return reply.code(200).send({ ok: true });
  });

  app.post('/chat/sessions/:sessionId/messages', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = sendMessageRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(validationErrorBody(parsed.error));

    const { orgId, userId } = getAuth(request);
    const { sessionId } = request.params as { sessionId: string };

    // Anti-IDOR: a session that isn't this org's resolves to nothing → 404 (no existence leak).
    const session = await deps.chatStore.getSessionForOrg(sessionId, orgId);
    if (!session) return reply.code(404).send({ error: 'NotFound' });

    // Take over the socket and stream SSE events: text-delta* then exactly one done|error.
    reply.hijack();
    const raw = reply.raw;
    // Hijacking bypasses Fastify's send path, so the CORS headers the plugin already set on
    // `reply` must be copied by hand or the browser rejects the stream. Flushing sends them
    // now instead of with the first delta (which can be tens of seconds away).
    const headers: Record<string, string> = {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    };
    for (const name of ['access-control-allow-origin', 'access-control-allow-credentials', 'vary']) {
      const value = reply.getHeader(name);
      if (typeof value === 'string') headers[name] = value;
    }
    raw.writeHead(200, headers);
    raw.flushHeaders();
    const write = (event: ChatStreamEvent): void => {
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      const outcome = await deps.service.sendMessage(
        { orgId, userId, sessionId, message: parsed.data.message, modelOverride: parsed.data.model },
        { onTextDelta: (delta) => write({ type: 'text-delta', delta }) },
      );
      if (outcome.outcome === 'answered') {
        write({ type: 'done', messageId: outcome.messageId, model: outcome.model });
      } else {
        write({ type: 'error', code: outcome.code, message: outcome.message });
      }
    } catch {
      // Never leak a stack trace into the stream — a sanitized terminal error only.
      write({ type: 'error', code: 'unknown', message: CHAT_ERROR_MESSAGES.unknown });
    } finally {
      raw.end();
    }
  });
}
