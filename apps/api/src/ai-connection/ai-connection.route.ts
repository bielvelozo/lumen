import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { connectAiRequestSchema } from '@lumen/shared';
import type { AiConnectionService } from './ai-connection.service';
import { getAuth } from '../auth/require-auth';
import { validationErrorBody } from '../auth/http-validation';

/**
 * Register the AI-connection routes (all `requireAuth`). `org_id` is resolved ONLY from the JWT
 * via `getAuth` — the body carries the key + model but never an `org_id`/connection id
 * (anti-IDOR). The key is never returned; failures carry only a sanitized category.
 */
export function registerAiConnectionRoutes(
  app: FastifyInstance,
  service: AiConnectionService,
  requireAuth: preHandlerHookHandler,
): void {
  app.get('/ai-connection', { preHandler: requireAuth }, async (request, reply) => {
    const { orgId } = getAuth(request);
    return reply.code(200).send(await service.getState(orgId));
  });

  // Paste/re-key (apiKey present) or re-validate the stored key (apiKey absent) + validate.
  app.put('/ai-connection', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = connectAiRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      // Includes a model outside the curated list — rejected BEFORE any provider call.
      return reply.code(400).send(validationErrorBody(parsed.error));
    }
    const { orgId } = getAuth(request);
    const result = await service.connect(orgId, parsed.data);
    if (result.outcome === 'no_connection') {
      return reply.code(404).send({ error: 'NoConnection' });
    }
    // Both 'connected' and 'validation_failed' are 200: the result body carries state + the
    // sanitized error category (a failed key is a normal, well-formed outcome).
    return reply.code(200).send(result.result);
  });
}
