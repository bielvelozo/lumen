import { and, eq } from 'drizzle-orm';
import type { ExposedColumn, ExposureResponse } from '@lumen/shared';
import { exposedTables, exposedRelationships } from '../db/schema';
import type { Database } from '../db/client';

/** A table to persist into the allow-list (column snapshot is backend-derived). */
export interface ExposureTableInput {
  name: string;
  columns: ExposedColumn[];
}

/** A relationship to persist (child→parent, derived from the FK, not the client). */
export interface ExposureRelationshipInput {
  name: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

export interface ExposureInput {
  tables: ExposureTableInput[];
  relationships: ExposureRelationshipInput[];
}

export interface ExposureStore {
  getExposure(orgId: string, dbConnectionId: string): Promise<ExposureResponse>;
  /** Replace the WHOLE allow-list for the connection atomically (delete + insert in one tx). */
  replaceExposure(orgId: string, dbConnectionId: string, exposure: ExposureInput): Promise<void>;
}

export function makeDrizzleExposureStore(db: Database): ExposureStore {
  return {
    async getExposure(orgId: string, dbConnectionId: string): Promise<ExposureResponse> {
      // Scope by BOTH org_id (tenant isolation) and the connection id.
      const tableRows = await db
        .select({ name: exposedTables.tableName, columns: exposedTables.columns })
        .from(exposedTables)
        .where(
          and(eq(exposedTables.orgId, orgId), eq(exposedTables.dbConnectionId, dbConnectionId)),
        );
      const relRows = await db
        .select({
          name: exposedRelationships.relationshipName,
          fromTable: exposedRelationships.fromTable,
          fromColumn: exposedRelationships.fromColumn,
          toTable: exposedRelationships.toTable,
          toColumn: exposedRelationships.toColumn,
        })
        .from(exposedRelationships)
        .where(
          and(
            eq(exposedRelationships.orgId, orgId),
            eq(exposedRelationships.dbConnectionId, dbConnectionId),
          ),
        );
      return {
        tables: tableRows.map((r) => ({ name: r.name, columns: r.columns })),
        relationships: relRows,
      };
    },

    async replaceExposure(
      orgId: string,
      dbConnectionId: string,
      exposure: ExposureInput,
    ): Promise<void> {
      // Atomic replace: relationships first (FK-free), then tables, then re-insert. Omitted
      // tables (and any relationship that referenced them) simply disappear — no dangling
      // relationship can survive (the un-expose cascade is structural).
      await db.transaction(async (tx) => {
        await tx
          .delete(exposedRelationships)
          .where(
            and(
              eq(exposedRelationships.orgId, orgId),
              eq(exposedRelationships.dbConnectionId, dbConnectionId),
            ),
          );
        await tx
          .delete(exposedTables)
          .where(
            and(eq(exposedTables.orgId, orgId), eq(exposedTables.dbConnectionId, dbConnectionId)),
          );

        if (exposure.tables.length > 0) {
          await tx.insert(exposedTables).values(
            exposure.tables.map((t) => ({
              orgId,
              dbConnectionId,
              tableName: t.name,
              columns: t.columns,
            })),
          );
        }
        if (exposure.relationships.length > 0) {
          await tx.insert(exposedRelationships).values(
            exposure.relationships.map((r) => ({
              orgId,
              dbConnectionId,
              relationshipName: r.name,
              fromTable: r.fromTable,
              fromColumn: r.fromColumn,
              toTable: r.toTable,
              toColumn: r.toColumn,
            })),
          );
        }
      });
    },
  };
}
