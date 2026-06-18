import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { sendMessageRequestSchema, type ChatStreamEvent } from '@lumen/shared';
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
    raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const write = (event: ChatStreamEvent): void => {
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    try {
      const outcome = await deps.service.sendMessage(
        { orgId, userId, sessionId, message: parsed.data.message },
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
