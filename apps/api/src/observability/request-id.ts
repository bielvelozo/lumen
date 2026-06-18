import { randomBytes } from 'node:crypto';

/**
 * An opaque per-request correlation id (spec 15). It is RANDOM — it encodes no user, org, email,
 * or secret — so it can safely become a Sentry tag and be returned on error responses without
 * leaking PII. Used as Fastify's `genReqId`, so it rides `request.id`.
 */
export function makeRequestId(): string {
  return `req_${randomBytes(12).toString('hex')}`;
}
