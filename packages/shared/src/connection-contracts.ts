/**
 * Client-DB connection contracts (spec 08). The owner submits MySQL coordinates + the
 * read-only password; the server encrypts the password, runs a live test, and reports a
 * SANITIZED public state. No `org_id` is ever accepted from the client (anti-IDOR); no raw
 * driver error is ever surfaced (only a safe category).
 */
import { z } from 'zod';
import { CONNECTION_STATUSES } from './db-contracts';

/**
 * `PUT /db-connection` request. `.strict()` rejects unknown fields (no `org_id` / connection
 * `id`). The password is the read-only user's password — non-empty; it exists only to be
 * encrypted + used for the test, never echoed.
 */
export const dbConnectionConfigSchema = z
  .object({
    host: z.string().trim().min(1, 'Host is required').max(255),
    port: z.number().int().min(1).max(65535),
    databaseName: z.string().trim().min(1, 'Database name is required').max(64),
    username: z.string().trim().min(1, 'Username is required').max(64),
    password: z.string().min(1, 'Password is required').max(512),
    sslEnabled: z.boolean().default(true),
  })
  .strict();

export type DbConnectionConfig = z.infer<typeof dbConnectionConfigSchema>;

/**
 * The CLOSED set of safe error categories. A raw MySQL/driver error is mapped to one of
 * these before it touches `last_error`, the response, or logs (the raw text can leak
 * hostnames, schema/table names, or data fragments).
 */
export const CONNECTION_ERROR_CATEGORIES = [
  'auth_failed',
  'host_unreachable',
  'connection_refused',
  'timeout',
  'ssl_error',
  'database_not_found',
  'access_denied',
  'unknown',
] as const;

export type ConnectionErrorCategory = (typeof CONNECTION_ERROR_CATEGORIES)[number];

export const connectionStatusSchema = z.enum(CONNECTION_STATUSES);

/**
 * The non-secret connection config the dashboard displays (spec 10). NEVER the password.
 */
export const dbConnectionConfigPublicSchema = z.object({
  host: z.string(),
  port: z.number(),
  databaseName: z.string(),
  username: z.string(),
  sslEnabled: z.boolean(),
});

export type DbConnectionConfigPublic = z.infer<typeof dbConnectionConfigPublicSchema>;

/**
 * The public connection state returned by `GET /db-connection`. Carries NO secrets — the
 * non-secret `config` (host/port/db/user/ssl) is included for the dashboard, but the
 * password is never returned.
 */
export const dbConnectionStateSchema = z.object({
  hasConnection: z.boolean(),
  status: connectionStatusSchema.nullable(),
  lastTestedAt: z.string().nullable(),
  lastError: z.enum(CONNECTION_ERROR_CATEGORIES).nullable(),
  config: dbConnectionConfigPublicSchema.nullable(),
});

export type DbConnectionState = z.infer<typeof dbConnectionStateSchema>;
