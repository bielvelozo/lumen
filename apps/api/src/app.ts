import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import type { HealthResponse } from '@lumen/shared';
import { makeRequestId } from './observability/request-id';
import { Sentry } from './observability/sentry';
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
import type { DbConnectionService } from './db-connection/db-connection.service';
import { registerDbConnectionRoutes } from './db-connection/db-connection.route';
import type { ExposureService } from './db-connection/exposure.service';
import { registerExposureRoutes } from './db-connection/exposure.route';
import type { AiConnectionService } from './ai-connection/ai-connection.service';
import { registerAiConnectionRoutes } from './ai-connection/ai-connection.route';
import type { ChatRouteDeps } from './chat/chat.route';
import { registerChatRoutes } from './chat/chat.route';
import type { AuditStore } from './audit/audit.store';
import { registerAuditRoutes } from './audit/audit.route';

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
  /** DB-connection consent + create/test routes (specs 07/08). `requireAuth` from the JWT. */
  dbConnection?: {
    consentService: ConsentService;
    /** spec 08 create/test connection (optional until spec 08 wires it). */
    dbConnectionService?: DbConnectionService;
    /** spec 09 introspection + exposure allow-list (optional until spec 09 wires it). */
    exposureService?: ExposureService;
    accessTokenService: AccessTokenService;
  };
  /** AI-connection (Claude BYO key) routes (spec 11). `requireAuth` from the JWT. */
  aiConnection?: {
    aiConnectionService: AiConnectionService;
    accessTokenService: AccessTokenService;
  };
  /** Chat orchestrator routes (spec 13). `requireAuth` from the JWT. */
  chat?: ChatRouteDeps & {
    accessTokenService: AccessTokenService;
  };
  /** Audit read endpoint (spec 15). `requireAuth` from the JWT. */
  audit?: {
    auditStore: AuditStore;
    accessTokenService: AccessTokenService;
  };
  /**
   * Cross-site CORS (spec 16). `origins` is the EXPLICIT allow-list (the production Pages
   * origin(s)) permitted to call the API with credentials. NEVER `*` — the browser rejects
   * `*` + credentials, and a wildcard would defeat the cookie's site scoping.
   */
  cors?: { origins: string[] };
}

/**
 * Build the Fastify application. `GET /health` is always present. Each later spec
 * registers its routes here, gated on the matching dependency being supplied. Returned
 * (not auto-started) so tests can drive it via `app.inject` without binding a port.
 */
export function buildApp(deps: AppDeps = {}): FastifyInstance {
  // `genReqId` gives every request an OPAQUE correlation id (no PII) — it rides `request.id`,
  // becomes the Sentry tag, and is returned on errors so a user report maps to an event.
  const app = Fastify({ logger: false, genReqId: makeRequestId });

  // A sanitized last-resort error handler: report to Sentry (no-op when disabled) and return ONLY
  // the opaque request id — never a stack trace or internal detail.
  app.setErrorHandler((error, request, reply) => {
    reply.header('x-request-id', String(request.id));
    // Fastify's own client errors (malformed JSON, empty JSON body, oversized payload) carry a
    // 4xx statusCode; they are the caller's fault, not an incident — never a 500, never Sentry.
    const raw = (error as { statusCode?: unknown }).statusCode;
    const statusCode = typeof raw === 'number' ? raw : 500;
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: 'BadRequest', requestId: request.id });
    }
    Sentry.captureException(error, (scope) => {
      scope.setTag('request_id', String(request.id));
      return scope;
    });
    return reply.code(500).send({ error: 'InternalError', requestId: request.id });
  });

  // Cross-site CORS — registered early so it handles preflight for every route. `credentials`
  // is on (the cross-site auth cookie must be sent), so `origin` MUST be an explicit allow-list,
  // never `*`. An off-list origin gets no `Access-Control-Allow-Origin` and the browser blocks it.
  if (deps.cors) {
    app.register(cors, {
      origin: deps.cors.origins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    });
  }

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
  if (deps.auth || deps.dbConnection || deps.aiConnection || deps.chat || deps.audit) {
    app.register(cookie);
  }

  if (deps.auth) {
    registerAuthRoutes(app, deps.auth);
  }

  if (deps.dbConnection) {
    const requireAuth = makeRequireAuth(deps.dbConnection.accessTokenService);
    registerConsentRoutes(app, deps.dbConnection.consentService, requireAuth);
    if (deps.dbConnection.dbConnectionService) {
      registerDbConnectionRoutes(app, deps.dbConnection.dbConnectionService, requireAuth);
    }
    if (deps.dbConnection.exposureService) {
      registerExposureRoutes(app, deps.dbConnection.exposureService, requireAuth);
    }
  }

  if (deps.aiConnection) {
    const requireAuth = makeRequireAuth(deps.aiConnection.accessTokenService);
    registerAiConnectionRoutes(app, deps.aiConnection.aiConnectionService, requireAuth);
  }

  if (deps.chat) {
    const requireAuth = makeRequireAuth(deps.chat.accessTokenService);
    registerChatRoutes(app, { service: deps.chat.service, chatStore: deps.chat.chatStore }, requireAuth);
  }

  if (deps.audit) {
    const requireAuth = makeRequireAuth(deps.audit.accessTokenService);
    registerAuditRoutes(app, deps.audit.auditStore, requireAuth);
  }

  return app;
}
