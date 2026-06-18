import type { FastifyInstance } from 'fastify';
import { signupRequestSchema } from '@lumen/shared';
import type { SignupService } from './signup.service';

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
      const flat = parsed.error.flatten();
      const fields: Record<string, string> = {};
      for (const [key, messages] of Object.entries(flat.fieldErrors)) {
        const first = messages?.[0];
        if (first) fields[key] = first;
      }
      return reply.code(400).send({
        error: 'ValidationError',
        fields,
        // Non-field issues (e.g. unknown keys from .strict()).
        formErrors: flat.formErrors,
      });
    }

    const response = await service.signup(parsed.data);
    return reply.code(201).send(response);
  });
}
