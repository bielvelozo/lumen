import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import type { HealthResponse } from '@lumen/shared';
import type { SignupService } from './auth/signup.service';
import { registerSignupRoute } from './auth/signup.route';
import type { VerificationService } from './auth/verification.service';
import { registerVerificationRoutes } from './auth/verification.route';
import type { AuthRouteDeps } from './auth/auth.route';
import { registerAuthRoutes } from './auth/auth.route';
import type { AccessTokenService } from './auth/jwt';
import { makeRequireAuth } from './auth/require-auth';
import type { ConsentService } from './db-connection/consent.service';
import { registerConsentRoutes } from './db-connection/consent.route';

/**
 * Dependencies injected into the app. Optional so `/health` (and the existing
 * health-only test) can build the app with no DB/crypto wiring; a feature's routes are
 * registered only when its dependency is supplied. `server.ts` builds the real deps from
 * validated env; tests pass fakes.
 */
export interface AppDeps {
  signupService?: SignupService;
  verificationService?: VerificationService;
  auth?: AuthRouteDeps;
  /** DB-connection consent + onboarding-script routes (spec 07). `requireAuth` from the JWT. */
  dbConnection?: { consentService: ConsentService; accessTokenService: AccessTokenService };
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

  if (deps.verificationService) {
    registerVerificationRoutes(app, deps.verificationService);
  }

  // The cookie plugin must load ONCE, before any route/requireAuth that reads cookies.
  // Register it if any cookie-dependent feature is wired.
  if (deps.auth || deps.dbConnection) {
    app.register(cookie);
  }

  if (deps.auth) {
    registerAuthRoutes(app, deps.auth);
  }

  if (deps.dbConnection) {
    const requireAuth = makeRequireAuth(deps.dbConnection.accessTokenService);
    registerConsentRoutes(app, deps.dbConnection.consentService, requireAuth);
  }

  return app;
}
