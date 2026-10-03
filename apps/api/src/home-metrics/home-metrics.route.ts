import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import { salesMappingSchema, type SalesMappingResponse } from '@lumen/shared';
import { getAuth } from '../auth/require-auth';
import { validationErrorBody } from '../auth/http-validation';
import type { HomeMetricsService } from './home-metrics.service';

/**
 * Home sales metrics (spec 17). `org_id` comes only from the JWT (anti-IDOR); the saved mapping
 * is names the registry guard re-checks, and the figures come from `aggregate_over_time`.
 */
export function registerHomeMetricsRoutes(
  app: FastifyInstance,
  service: HomeMetricsService,
  requireAuth: preHandlerHookHandler,
): void {
  app.get('/sales-mapping', { preHandler: requireAuth }, async (request, reply) => {
    const { orgId } = getAuth(request);
    const body: SalesMappingResponse = { mapping: await service.getMapping(orgId) };
    return reply.code(200).send(body);
  });

  app.put('/sales-mapping', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = salesMappingSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(validationErrorBody(parsed.error));
    }
    const { orgId } = getAuth(request);
    const result = await service.saveMapping(orgId, parsed.data);
    switch (result.outcome) {
      case 'saved':
        return reply.code(200).send({ mapping: result.mapping } satisfies SalesMappingResponse);
      case 'no_connection':
        return reply.code(404).send({ error: 'NoConnection' });
      case 'invalid':
        return reply.code(422).send({ error: 'InvalidSalesMapping', code: result.code });
    }
  });

  app.get('/home/metrics', { preHandler: requireAuth }, async (request, reply) => {
    const { orgId } = getAuth(request);
    return reply.code(200).send(await service.getMetrics(orgId));
  });
}
