/**
 * Schema-introspection + exposure-allow-list contracts (spec 09). Introspection is the live,
 * read-only discovery of the customer's MySQL schema; exposure is the owner's least-privilege
 * choice of which discovered tables/relationships the assistant may touch. The client only
 * ever chooses NAMES from what the backend discovered — column snapshots and FK directions are
 * always backend-derived (Gate-2: a client cannot inject a fake table/column/relationship).
 */
import { z } from 'zod';
import { type ExposedColumn } from './db-contracts';

/** A discovered table + its column snapshot (`type` is the MySQL `information_schema` type). */
export interface IntrospectedTable {
  name: string;
  columns: ExposedColumn[];
}

/** A discovered single-column foreign key, child→parent. `name` is deterministic + stable. */
export interface IntrospectedRelationship {
  name: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

/** The result of a live, read-only introspection. */
export interface IntrospectedSchema {
  tables: IntrospectedTable[];
  relationships: IntrospectedRelationship[];
}

/**
 * `PUT /db-connection/exposure` request. The owner submits ONLY the names they chose from the
 * discovered schema. `.strict()` rejects unknown fields (no `org_id`, no connection id — the
 * connection is resolved from the JWT). The backend validates these names against a fresh
 * introspection and builds the persisted rows from the introspection, never from this input.
 */
export const saveExposureRequestSchema = z
  .object({
    tableNames: z.array(z.string().min(1)).max(500),
    relationshipNames: z.array(z.string().min(1)).max(2000),
  })
  .strict();

export type SaveExposureRequest = z.infer<typeof saveExposureRequestSchema>;

/** The current persisted allow-list (response of GET/PUT exposure). */
export const exposureResponseSchema = z.object({
  tables: z.array(
    z.object({
      name: z.string(),
      columns: z.array(z.object({ name: z.string(), type: z.string() })),
    }),
  ),
  relationships: z.array(
    z.object({
      name: z.string(),
      fromTable: z.string(),
      fromColumn: z.string(),
      toTable: z.string(),
      toColumn: z.string(),
    }),
  ),
});

export type ExposureResponse = z.infer<typeof exposureResponseSchema>;
