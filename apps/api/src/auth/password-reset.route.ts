import type { FastifyInstance } from 'fastify';
import { forgotPasswordRequestSchema, resetPasswordRequestSchema } from '@lumen/shared';
import type { PasswordResetService } from './password-reset.service';
import { validationErrorBody } from './http-validation';

/**
 * Register the password-reset routes (unauthenticated):
 *  - `POST /auth/forgot-password` — always the same generic `202` body, whether or not the
 *    address has an account (anti-enumeration).
 *  - `POST /auth/reset-password` — consumes the opaque link token and sets the new password.
 *    An unusable token (unknown / expired / already spent) is a `400`, so the UI can tell
 *    "done" from "ask for a new link"; it never says WHICH of the three it was.
 * Neither route ever echoes a token.
 */
export function registerPasswordResetRoutes(
  app: FastifyInstance,
  service: PasswordResetService,
): void {
  app.post('/auth/forgot-password', async (request, reply) => {
    const parsed = forgotPasswordRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(validationErrorBody(parsed.error));
    }
    return reply.code(202).send(await service.requestReset(parsed.data.email));
  });

  app.post('/auth/reset-password', async (request, reply) => {
    const parsed = resetPasswordRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(validationErrorBody(parsed.error));
    }
    const ok = await service.resetPassword(parsed.data.token, parsed.data.password);
    if (!ok) return reply.code(400).send({ error: 'InvalidResetToken' });
    return reply.code(200).send({ ok: true });
  });
}
