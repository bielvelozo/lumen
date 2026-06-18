/**
 * Audit contracts (spec 15) — the READ path over the `function_call_logs` rows the orchestrator
 * (spec 13) writes. The endpoint is `org_id`-scoped from the JWT (anti-IDOR); the response carries
 * ONLY already-sanitized fields (no value that could be raw customer data). No `org_id` is ever
 * accepted from the client.
 */
import { z } from 'zod';
import { LOG_STATUSES } from './db-contracts';

export const AUDIT_PAGE_SIZE_MAX = 50;

/** `GET /audit/function-calls` query — filters + pagination. `.strict()` rejects a smuggled org_id. */
export const auditQuerySchema = z
  .object({
    status: z.enum(LOG_STATUSES).optional(),
    functionName: z.string().min(1).max(64).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(AUDIT_PAGE_SIZE_MAX).default(20),
  })
  .strict();

export type AuditQuery = z.infer<typeof auditQuerySchema>;

/** One audit row as the owner sees it — sanitized fields only (params are names/shape, no values). */
export interface AuditLogDTO {
  id: string;
  functionName: string;
  status: 'success' | 'failed';
  durationMs: number | null;
  provider: string | null;
  model: string | null;
  params: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface AuditPageResponse {
  items: AuditLogDTO[];
  page: number;
  hasMore: boolean;
}
