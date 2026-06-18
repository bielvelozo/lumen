import { and, desc, eq, type SQL } from 'drizzle-orm';
import type { AuditLogDTO, AuditQuery } from '@lumen/shared';
import { functionCallLogs } from '../db/schema';
import type { Database } from '../db/client';

export interface AuditStore {
  /** The caller's function-call logs, newest-first, filtered + paginated. ORG-SCOPED ONLY. */
  listForOrg(orgId: string, query: AuditQuery): Promise<{ items: AuditLogDTO[]; hasMore: boolean }>;
}

export function makeDrizzleAuditStore(db: Database): AuditStore {
  return {
    async listForOrg(orgId, query) {
      // `org_id` is ALWAYS the first filter — never a client-supplied id (anti-IDOR).
      const conditions: SQL[] = [eq(functionCallLogs.orgId, orgId)];
      if (query.status) conditions.push(eq(functionCallLogs.status, query.status));
      if (query.functionName) conditions.push(eq(functionCallLogs.functionName, query.functionName));

      const offset = (query.page - 1) * query.limit;
      // Fetch one extra row to compute `hasMore` without a separate count query.
      const rows = await db
        .select({
          id: functionCallLogs.id,
          functionName: functionCallLogs.functionName,
          status: functionCallLogs.status,
          durationMs: functionCallLogs.durationMs,
          provider: functionCallLogs.provider,
          model: functionCallLogs.model,
          params: functionCallLogs.params,
          errorMessage: functionCallLogs.errorMessage,
          createdAt: functionCallLogs.createdAt,
        })
        .from(functionCallLogs)
        .where(and(...conditions))
        .orderBy(desc(functionCallLogs.createdAt)) // uses idx_log_org_created
        .limit(query.limit + 1)
        .offset(offset);

      const hasMore = rows.length > query.limit;
      const items: AuditLogDTO[] = rows.slice(0, query.limit).map((r) => ({
        id: r.id,
        functionName: r.functionName,
        status: r.status,
        durationMs: r.durationMs,
        provider: r.provider,
        model: r.model,
        params: r.params ?? null,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt.toISOString(),
      }));
      return { items, hasMore };
    },
  };
}
