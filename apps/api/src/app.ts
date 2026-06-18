import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@lumen/shared';

/**
 * Build the Fastify application. v1 ships only a `GET /health` probe; every later
 * spec registers its routes/plugins onto this factory. Returned (not auto-started)
 * so tests can drive it via `app.inject` without binding a port.
 */
export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health', async (): Promise<HealthResponse> => {
    return { status: 'ok' };
  });

  return app;
}
