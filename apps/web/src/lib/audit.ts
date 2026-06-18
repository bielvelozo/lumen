import type { AuditPageResponse, LogStatus } from '@lumen/shared';
import { apiFetch } from './api-client';

export interface AuditFilters {
  page: number;
  status?: LogStatus;
  functionName?: string;
}

/**
 * Fetch the org's function-call audit logs (spec 15). Via `apiFetch` (cookie auth, no `org_id`
 * ever) — the backend scopes by the JWT org. Only sanitized fields come back.
 */
export const getAuditLogs = (filters: AuditFilters): Promise<AuditPageResponse> => {
  const params = new URLSearchParams({ page: String(filters.page) });
  if (filters.status) params.set('status', filters.status);
  if (filters.functionName) params.set('functionName', filters.functionName);
  return apiFetch(`/audit/function-calls?${params.toString()}`);
};
