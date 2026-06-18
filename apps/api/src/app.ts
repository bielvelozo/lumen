import Fastify, { type FastifyInstance } from 'fastify';
import type { HealthResponse } from '@lumen/shared';
import type { SignupService } from './auth/signup.service';
import { registerSignupRoute } from './auth/signup.route';

/**
 * Dependencies injected into the app. Optional so `/health` (and the existing
 * health-only test) can build the app with no DB/crypto wiring; a feature's routes are
 * registered only when its dependency is supplied. `server.ts` builds the real deps from
 * validated env; tests pass fakes.
 */
export interface AppDeps {
  signupService?: SignupService;
}

/**
 * Build the Fastify application. `GET /health` is always present. Each later spec
 * registers its routes here, gated on the matching dependency being supplied. Returned
 * (not auto-started) so tests can drive it via `app.inject` without binding a port.
 */
export function buildApp(deps: AppDeps = {}): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/health', async (): Promise<HealthResponse> => {
    return { status: 'ok' };
  });

  if (deps.signupService) {
    registerSignupRoute(app, deps.signupService);
  }

  return app;
}
