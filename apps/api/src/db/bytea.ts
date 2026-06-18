import { customType } from 'drizzle-orm/pg-core';

/**
 * PostgreSQL `bytea`. Drizzle has no first-class `bytea`, so this customType emits
 * `bytea` and types the value as a Node `Buffer` — never `string`. The secret
 * columns (`db_connections.encrypted_password`, `ai_connections.encrypted_api_key`)
 * use this so an encrypted blob can never be accidentally surfaced or written as a
 * plaintext string (constitution invariant 2). Encryption/decryption itself is
 * spec 02; here this is only the column type, with no value transform.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});
