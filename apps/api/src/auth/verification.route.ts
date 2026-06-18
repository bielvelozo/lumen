import type { FastifyInstance } from 'fastify';
import { verifyEmailRequestSchema, resendVerificationRequestSchema } from '@lumen/shared';
import type { VerificationService } from './verification.service';
import { validationErrorBody } from './http-validation';

/**
 * Register the email-verification routes (unauthenticated):
 *  - `POST /auth/verify-email` — consumes the opaque link token, returns the outcome
 *    (`verified` / `already_verified` / `invalid`). Accepts ONLY the token (anti-IDOR);
 *    the user is derived server-side from the hash-matched row.
 *  - `POST /auth/resend-verification` — always returns the same generic `202` body
 *    regardless of whether the email exists or is already verified (anti-enumeration).
 * Neither route ever echoes a token.
 */
export function registerVerificationRoutes(
  app: FastifyInstance,
  service: VerificationService,
): void {
  app.post('/auth/verify-email', async (request, reply) => {
    const parsed = verifyEmailRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(validationErrorBody(parsed.error));
    }
    const status = await service.verifyEmail(parsed.data.token);
    return reply.code(200).send({ status });
  });

  app.post('/auth/resend-verification', async (request, reply) => {
    const parsed = resendVerificationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(validationErrorBody(parsed.error));
    }
    const response = await service.resendVerification(parsed.data.email);
    return reply.code(202).send(response);
  });
}
