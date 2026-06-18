import type { FastifyInstance, preHandlerHookHandler, FastifyReply } from 'fastify';
import { saveExposureRequestSchema } from '@lumen/shared';
import type { ExposureService, IntrospectResult, SaveExposureResult } from './exposure.service';
import { getAuth } from '../auth/require-auth';
import { validationErrorBody } from '../auth/http-validation';

/**
 * Register the introspection + exposure routes (all `requireAuth`). The connection is
 * resolved ONLY from `getAuth(request).orgId` (v1 = one per org) — no connection id is
 * accepted from the client (anti-IDOR). Introspection is read-only; exposure persists the
 * owner's chosen allow-list (names validated against a fresh introspection).
 */
export function registerExposureRoutes(
  app: FastifyInstance,
  service: ExposureService,
  requireAuth: preHandlerHookHandler,
): void {
  app.get('/db-connection/introspect', { preHandler: requireAuth }, async (request, reply) => {
    const { orgId } = getAuth(request);
    const result = await service.introspect(orgId);
    if (result.outcome === 'ok') return reply.code(200).send(result.schema);
    return sendIntrospectError(reply, result);
  });

  app.get('/db-connection/exposure', { preHandler: requireAuth }, async (request, reply) => {
    const { orgId } = getAuth(request);
    const result = await service.getExposure(orgId);
    if (result.outcome === 'no_connection') return reply.code(404).send({ error: 'NoConnection' });
    return reply.code(200).send(result.exposure);
  });

  app.put('/db-connection/exposure', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = saveExposureRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(validationErrorBody(parsed.error));
    }
    const { orgId } = getAuth(request);
    const result = await service.saveExposure(orgId, parsed.data);
    if (result.outcome === 'saved') return reply.code(200).send(result.exposure);
    return sendSaveError(reply, result);
  });
}

function sendIntrospectError(
  reply: FastifyReply,
  result: Exclude<IntrospectResult, { outcome: 'ok' }>,
): FastifyReply {
  switch (result.outcome) {
    case 'no_connection':
      return reply.code(404).send({ error: 'NoConnection' });
    case 'not_active':
      return reply.code(409).send({ error: 'ConnectionNotActive' });
    case 'failed':
      return reply.code(502).send({ error: 'IntrospectionFailed', category: result.category });
  }
}

function sendSaveError(
  reply: FastifyReply,
  result: Exclude<SaveExposureResult, { outcome: 'saved' }>,
): FastifyReply {
  switch (result.outcome) {
    case 'no_connection':
      return reply.code(404).send({ error: 'NoConnection' });
    case 'not_active':
      return reply.code(409).send({ error: 'ConnectionNotActive' });
    case 'unknown_table':
      return reply.code(422).send({ error: 'UnknownTable', name: result.name });
    case 'unknown_relationship':
      return reply.code(422).send({ error: 'UnknownRelationship', name: result.name });
    case 'invariant_violation':
      return reply
        .code(422)
        .send({ error: 'RelationshipEndpointNotExposed', name: result.name });
    case 'failed':
      return reply.code(502).send({ error: 'IntrospectionFailed', category: result.category });
  }
}
