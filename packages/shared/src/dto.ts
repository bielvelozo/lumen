import { z } from 'zod';

/**
 * Shared request/response contracts consumed across the API/web boundary. Adding
 * a DTO here (instead of duplicating a type per app) is the pattern every later
 * spec follows.
 */

/** `GET /health` response. The API answers exactly `{ status: "ok" }`. */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
