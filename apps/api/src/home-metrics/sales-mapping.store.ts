import { eq } from 'drizzle-orm';
import type { SalesMapping } from '@lumen/shared';
import { salesMappings } from '../db/schema';
import type { Database } from '../db/client';

export interface SalesMappingStore {
  get(orgId: string): Promise<SalesMapping | null>;
  upsert(orgId: string, mapping: SalesMapping): Promise<void>;
}

export function makeDrizzleSalesMappingStore(db: Database): SalesMappingStore {
  return {
    async get(orgId) {
      const rows = await db
        .select({
          table: salesMappings.tableName,
          amountColumn: salesMappings.amountColumn,
          dateColumn: salesMappings.dateColumn,
        })
        .from(salesMappings)
        .where(eq(salesMappings.orgId, orgId))
        .limit(1);
      return rows[0] ?? null;
    },

    async upsert(orgId, mapping) {
      const values = {
        tableName: mapping.table,
        amountColumn: mapping.amountColumn,
        dateColumn: mapping.dateColumn,
        updatedAt: new Date(),
      };
      await db
        .insert(salesMappings)
        .values({ orgId, ...values })
        .onConflictDoUpdate({ target: salesMappings.orgId, set: values });
    },
  };
}
