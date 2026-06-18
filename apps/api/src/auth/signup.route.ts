import type { FastifyInstance } from 'fastify';
import { signupRequestSchema } from '@lumen/shared';
import type { SignupService } from './signup.service';
import { validationErrorBody } from './http-validation';

/**
 * Register `POST /auth/signup` (unauthenticated). Validates the body against the shared
 * Zod contract (`.strict()` rejects unknown fields — the endpoint never accepts an
 * `org_id`); on failure returns `400` with field-level errors and writes nothing. On
 * success it delegates to the service and returns `201` with the uniform, non-identifying
 * response. The raw body (and password) is never logged.
 */
export function registerSignupRoute(app: FastifyInstance, service: SignupService): void {
  app.post('/auth/signup', async (request, reply) => {
    const parsed = signupRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(validationErrorBody(parsed.error));
    }

    const response = await service.signup(parsed.data);
    return reply.code(201).send(response);
  });
}
