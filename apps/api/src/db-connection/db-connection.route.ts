import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { dbConnectionConfigSchema } from '@lumen/shared';
import type { DbConnectionService } from './db-connection.service';
import { getAuth } from '../auth/require-auth';
import { validationErrorBody } from '../auth/http-validation';

/**
 * Register the create/test connection routes (all `requireAuth`). `org_id` is resolved ONLY
 * from the JWT via `getAuth` — the body carries config but never an `org_id`/connection id
 * (anti-IDOR). Responses carry the SANITIZED public state, never the password or a raw error.
 */
export function registerDbConnectionRoutes(
  app: FastifyInstance,
  service: DbConnectionService,
  requireAuth: preHandlerHookHandler,
): void {
  app.get('/db-connection', { preHandler: requireAuth }, async (request, reply) => {
    const { orgId } = getAuth(request);
    return reply.code(200).send(await service.getState(orgId));
  });

  // Create-or-update + live test in one synchronous call.
  app.put('/db-connection', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = dbConnectionConfigSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(validationErrorBody(parsed.error));
    }
    const { orgId } = getAuth(request);
    const result = await service.createOrUpdate(orgId, parsed.data);
    if (result.outcome === 'no_consent') {
      return reply
        .code(403)
        .send({ error: 'ConsentRequired', message: 'Accept the connection terms first.' });
    }
    if (result.outcome === 'over_privileged') {
      // Invariant 5: never store a root/over-privileged credential — point at the script.
      return reply.code(422).send({
        error: 'CredentialOverPrivileged',
        message:
          'The credential is not read-only. Re-run the onboarding script to create a SELECT-only user.',
      });
    }
    return reply.code(200).send(result.state);
  });

  // Re-test the existing connection without re-supplying the password.
  app.post('/db-connection/test', { preHandler: requireAuth }, async (request, reply) => {
    const { orgId } = getAuth(request);
    const result = await service.retest(orgId);
    if (result.outcome === 'not_found') {
      return reply.code(404).send({ error: 'NoConnection' });
    }
    return reply.code(200).send(result.state);
  });
}
