/**
 * Drizzle schema — a 1:1 port of `db/schema.sql` (the DDL is the diff oracle).
 * Every enum value/order, column type, nullability, default, FK `ON DELETE` action,
 * UNIQUE constraint, and named index (including the two `DESC` ones) matches the DDL.
 *
 * Invariant 1 (anti-IDOR, defense in depth): `org_id` is carried — denormalized and
 * `NOT NULL` — all the way down to `exposed_tables`, `exposed_relationships`,
 * `messages`, and `function_call_logs`, even where it is reachable via a parent FK.
 * Do NOT "normalize it away": every tenant query filters directly by `org_id`.
 *
 * The DB identifiers (snake_case table/column/index names) are pinned to match the
 * DDL exactly; the TS identifiers are camelCase via Drizzle's name mapping.
 */
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import {
  USER_ROLES,
  CONNECTION_STATUSES,
  MESSAGE_ROLES,
  LOG_STATUSES,
} from '@lumen/shared';
import type { ExposedColumn } from '@lumen/shared';
import { bytea } from './bytea';

// ---------------------------------------------------------------------------
// Enums (4) — values and order match db/schema.sql exactly.
// ---------------------------------------------------------------------------
export const userRoleEnum = pgEnum('user_role', USER_ROLES);
export const connectionStatusEnum = pgEnum('connection_status', CONNECTION_STATUSES);
export const messageRoleEnum = pgEnum('message_role', MESSAGE_ROLES);
export const logStatusEnum = pgEnum('log_status', LOG_STATUSES);

// Shared timestamptz helper: all *_at columns are `timestamptz`. `mode: 'date'`
// fixes the JS type to `Date` (it does not change the emitted SQL).
const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// ---------------------------------------------------------------------------
// organizations — the tenant.
// ---------------------------------------------------------------------------
export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: tz('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// users — one owner per org in v1 ('member' is a v2 enum value, no tables for it).
// ---------------------------------------------------------------------------
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    role: userRoleEnum('role').notNull().default('owner'),
    emailVerified: boolean('email_verified').notNull().default(false),
    verifiedAt: tz('verified_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (table) => [index('idx_users_org').on(table.orgId)],
);

// ---------------------------------------------------------------------------
// email_verification_tokens — token stored HASHED (invariant 4).
// ---------------------------------------------------------------------------
export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: tz('expires_at').notNull(),
    usedAt: tz('used_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_evt_token').on(table.tokenHash),
    index('idx_evt_user').on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// password_reset_tokens — token stored HASHED (invariant 4); the raw value only ever
// exists in the emailed link.
// ---------------------------------------------------------------------------
export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: tz('expires_at').notNull(),
    usedAt: tz('used_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_prt_token').on(table.tokenHash),
    index('idx_prt_user').on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// refresh_tokens — token stored HASHED (invariant 4); raw value lives in the cookie.
// ---------------------------------------------------------------------------
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: tz('expires_at').notNull(),
    revokedAt: tz('revoked_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_rt_token').on(table.tokenHash),
    index('idx_rt_user').on(table.userId),
  ],
);

// ---------------------------------------------------------------------------
// db_connections — the client's DB (MySQL in v1). Secret password is `bytea`.
// `consent_accepted_by` is a NULLABLE FK with the DDL's default delete action
// (NO ACTION) — must NOT become CASCADE or SET NULL.
// ---------------------------------------------------------------------------
export const dbConnections = pgTable(
  'db_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    engine: text('engine').notNull().default('mysql'),
    host: text('host').notNull(),
    port: integer('port').notNull(),
    databaseName: text('database_name').notNull(),
    username: text('username').notNull(),
    sslEnabled: boolean('ssl_enabled').notNull().default(true),
    encryptedPassword: bytea('encrypted_password').notNull(),
    status: connectionStatusEnum('status').notNull().default('pending'),
    lastTestedAt: tz('last_tested_at'),
    lastError: text('last_error'),
    consentVersion: text('consent_version').notNull(),
    consentAcceptedAt: tz('consent_accepted_at').notNull(),
    consentAcceptedBy: uuid('consent_accepted_by').references(() => users.id),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_dbconn_org').on(table.orgId),
    // v1 = exactly one connection per org. Enabled by spec 08 so create-or-update is an
    // atomic upsert keyed by org_id (the constraint is the race backstop).
    unique('uq_dbconn_org').on(table.orgId),
  ],
);

// ---------------------------------------------------------------------------
// exposed_tables — table-level allow-list of what the assistant may see.
// `org_id` denormalized for tenant isolation (invariant 1).
// ---------------------------------------------------------------------------
export const exposedTables = pgTable(
  'exposed_tables',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dbConnectionId: uuid('db_connection_id')
      .notNull()
      .references(() => dbConnections.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    tableName: text('table_name').notNull(),
    columns: jsonb('columns').$type<ExposedColumn[]>().notNull().default([]),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('exposed_tables_db_connection_id_table_name_key').on(
      table.dbConnectionId,
      table.tableName,
    ),
    index('idx_exposed_org').on(table.orgId),
  ],
);

// ---------------------------------------------------------------------------
// exposed_relationships — allow-list of approved JOIN paths (FKs).
// `org_id` denormalized for tenant isolation (invariant 1).
// ---------------------------------------------------------------------------
export const exposedRelationships = pgTable(
  'exposed_relationships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dbConnectionId: uuid('db_connection_id')
      .notNull()
      .references(() => dbConnections.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    relationshipName: text('relationship_name').notNull(),
    fromTable: text('from_table').notNull(),
    fromColumn: text('from_column').notNull(),
    toTable: text('to_table').notNull(),
    toColumn: text('to_column').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('exposed_relationships_db_connection_id_relationship_name_key').on(
      table.dbConnectionId,
      table.relationshipName,
    ),
    index('idx_exposed_rel_org').on(table.orgId),
    index('idx_exposed_rel_conn').on(table.dbConnectionId),
  ],
);

// ---------------------------------------------------------------------------
// ai_connections — the AI provider (Claude in v1). Secret key is `bytea`.
// ---------------------------------------------------------------------------
export const aiConnections = pgTable(
  'ai_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('claude'),
    encryptedApiKey: bytea('encrypted_api_key').notNull(),
    defaultModel: text('default_model'),
    status: connectionStatusEnum('status').notNull().default('pending'),
    lastValidatedAt: tz('last_validated_at'),
    lastError: text('last_error'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_aiconn_org').on(table.orgId),
    // One AI connection per org (v1) — lets the app upsert by org and blocks a second row.
    unique('uq_aiconn_org').on(table.orgId),
  ],
);

// ---------------------------------------------------------------------------
// chat_sessions.
// ---------------------------------------------------------------------------
export const chatSessions = pgTable(
  'chat_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_session_org').on(table.orgId),
    // DDL is bare `DESC` (= Postgres default NULLS FIRST); match it exactly.
    index('idx_session_org_updated').on(table.orgId, table.updatedAt.desc().nullsFirst()),
  ],
);

// ---------------------------------------------------------------------------
// messages — content may carry the client's business data, so `org_id` travels
// with it (invariant 1).
// ---------------------------------------------------------------------------
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: messageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    model: text('model'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('idx_msg_session').on(table.sessionId, table.createdAt),
    index('idx_msg_org').on(table.orgId),
  ],
);

// ---------------------------------------------------------------------------
// function_call_logs — sanitized audit. `user_id` / `session_id` / `message_id`
// are nullable FKs with ON DELETE SET NULL; `org_id` stays NOT NULL (invariant 1).
// ---------------------------------------------------------------------------
export const functionCallLogs = pgTable(
  'function_call_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    sessionId: uuid('session_id').references(() => chatSessions.id, {
      onDelete: 'set null',
    }),
    messageId: uuid('message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    functionName: text('function_name').notNull(),
    params: jsonb('params').$type<Record<string, unknown>>(),
    status: logStatusEnum('status').notNull(),
    durationMs: integer('duration_ms'),
    provider: text('provider'),
    model: text('model'),
    errorMessage: text('error_message'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (table) => [
    // DDL is bare `DESC` (= Postgres default NULLS FIRST); match it exactly.
    index('idx_log_org_created').on(table.orgId, table.createdAt.desc().nullsFirst()),
  ],
);

// ---------------------------------------------------------------------------
// db_connection_consents — spec 07 (Option B). A lightweight, durable consent record
// written BEFORE any credential exists (db_connections.encrypted_password is NOT NULL, so
// consent cannot live on a bare db_connections row). Spec 08 reads/gates on this and
// copies the fields into the db_connections row on insert. NOT one of the original 11
// db/schema.sql tables. No secret column here (invariant 2 by omission).
// ---------------------------------------------------------------------------
export const dbConnectionConsents = pgTable(
  'db_connection_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    consentVersion: text('consent_version').notNull(),
    acceptedAt: tz('accepted_at').notNull().defaultNow(),
    acceptedBy: uuid('accepted_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (table) => [
    // One acceptance row per (org, version) — re-accepting the same version is idempotent.
    unique('db_connection_consents_org_id_consent_version_key').on(
      table.orgId,
      table.consentVersion,
    ),
    index('idx_dbconn_consent_org').on(table.orgId),
  ],
);

// ---------------------------------------------------------------------------
// Inferred row types (server-side). These carry `Buffer` secret columns and
// internal fields, so they stay in apps/api and are NOT exported through
// packages/shared (which would be a circular workspace dependency). The web only
// ever consumes serialization-safe DTOs defined per-endpoint by later specs.
// ---------------------------------------------------------------------------
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type EmailVerificationToken = typeof emailVerificationTokens.$inferSelect;
export type NewEmailVerificationToken = typeof emailVerificationTokens.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;
export type DbConnection = typeof dbConnections.$inferSelect;
export type NewDbConnection = typeof dbConnections.$inferInsert;
export type ExposedTable = typeof exposedTables.$inferSelect;
export type NewExposedTable = typeof exposedTables.$inferInsert;
export type ExposedRelationship = typeof exposedRelationships.$inferSelect;
export type NewExposedRelationship = typeof exposedRelationships.$inferInsert;
export type AiConnection = typeof aiConnections.$inferSelect;
export type NewAiConnection = typeof aiConnections.$inferInsert;
export type ChatSession = typeof chatSessions.$inferSelect;
export type NewChatSession = typeof chatSessions.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type FunctionCallLog = typeof functionCallLogs.$inferSelect;
export type NewFunctionCallLog = typeof functionCallLogs.$inferInsert;
export type DbConnectionConsent = typeof dbConnectionConsents.$inferSelect;
export type NewDbConnectionConsent = typeof dbConnectionConsents.$inferInsert;
