import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { auditQuerySchema } from '@lumen/shared';
import { getAuth } from '../auth/require-auth';
import { validationErrorBody } from '../auth/http-validation';
import type { AuditStore } from './audit.store';

/**
 * The audit READ path (spec 15). `GET /audit/function-calls` returns the caller's
 * `function_call_logs` — `org_id` from the JWT via `getAuth`, NEVER a query param/body
 * (anti-IDOR). Only already-sanitized fields are returned (params are names/shape, no values).
 */
export function registerAuditRoutes(
  app: FastifyInstance,
  store: AuditStore,
  requireAuth: preHandlerHookHandler,
): void {
  app.get('/audit/function-calls', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = auditQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(validationErrorBody(parsed.error));
    }
    const { orgId } = getAuth(request);
    const { items, hasMore } = await store.listForOrg(orgId, parsed.data);
    return reply.code(200).send({ items, page: parsed.data.page, hasMore });
  });
}
