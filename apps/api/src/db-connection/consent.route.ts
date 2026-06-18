import type { FastifyInstance, preHandlerHookHandler } from 'fastify';
import {
  acceptConsentRequestSchema,
  onboardingScriptRequestSchema,
  CONSENT_TERMS,
} from '@lumen/shared';
import type { ConsentService } from './consent.service';
import { buildOnboardingScript } from './onboarding-script';
import { getAuth } from '../auth/require-auth';
import { validationErrorBody } from '../auth/http-validation';

/**
 * Register the consent + onboarding-script routes (all `requireAuth`). The org and user are
 * resolved ONLY from the verified JWT via `getAuth` — the request body never carries an
 * `org_id` (anti-IDOR). No secret/credential is created here (spec 08 owns that).
 */
export function registerConsentRoutes(
  app: FastifyInstance,
  service: ConsentService,
  requireAuth: preHandlerHookHandler,
): void {
  // The current terms text (so the SPA renders exactly what maps to the version).
  app.get('/db-connection/consent/terms', { preHandler: requireAuth }, async (_request, reply) => {
    return reply.code(200).send(CONSENT_TERMS);
  });

  app.get('/db-connection/consent', { preHandler: requireAuth }, async (request, reply) => {
    const { orgId } = getAuth(request);
    return reply.code(200).send(await service.getStatus(orgId));
  });

  app.post('/db-connection/consent', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = acceptConsentRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(validationErrorBody(parsed.error));
    }
    const { orgId, userId } = getAuth(request);
    const result = await service.acceptConsent(orgId, userId, parsed.data.consentVersion);
    if (!result.ok) {
      // Terms changed since the version the client tried to accept — make them re-fetch.
      return reply
        .code(409)
        .send({ error: 'StaleConsentVersion', currentVersion: CONSENT_TERMS.version });
    }
    return reply.code(200).send(await service.getStatus(orgId));
  });

  app.post(
    '/db-connection/onboarding-script',
    { preHandler: requireAuth },
    async (request, reply) => {
      // Auth is required (this is owner guidance), but the script content is non-secret and
      // not org-specific; getAuth still gates access.
      getAuth(request);
      const parsed = onboardingScriptRequestSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send(validationErrorBody(parsed.error));
      }
      return reply.code(200).send(buildOnboardingScript(parsed.data));
    },
  );
}
