import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AuditPageResponse } from '@lumen/shared';
import { getAuditLogs, type AuditFilters } from './audit';

export const AUDIT_KEY = (filters: AuditFilters) =>
  ['audit', filters.page, filters.status ?? '', filters.functionName ?? ''] as const;

export function useAuditLogs(filters: AuditFilters): UseQueryResult<AuditPageResponse> {
  return useQuery({ queryKey: AUDIT_KEY(filters), queryFn: () => getAuditLogs(filters) });
}
