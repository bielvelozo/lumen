/**
 * Cross-boundary database primitives. These are the ONLY DB types that cross the
 * app/web boundary, so they live here (single definition) and are imported by the
 * Drizzle schema in `apps/api/src/db`. The Drizzle schema's inferred row types stay
 * server-side in `apps/api` (they carry `Buffer` secret columns the web must never
 * consume); `packages/shared` must NOT import from `apps/api` (circular dependency).
 *
 * Each enum is declared once as an `as const` tuple so the value AND order are the
 * single source of truth — the Drizzle `pgEnum` consumes the same tuple, keeping the
 * DB enum and the TS union in lockstep with `db/schema.sql`.
 */

export const USER_ROLES = ['owner', 'member'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const CONNECTION_STATUSES = ['pending', 'active', 'failed'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const MESSAGE_ROLES = ['user', 'assistant'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const LOG_STATUSES = ['success', 'failed'] as const;
export type LogStatus = (typeof LOG_STATUSES)[number];

/**
 * Shape of each entry in `exposed_tables.columns` (a `jsonb` array): the result of
 * introspecting one column of an exposed client table (name + SQL type). Used to
 * type the jsonb column in the schema so its shape is checked by `tsc`.
 */
export interface ExposedColumn {
  name: string;
  type: string;
}
