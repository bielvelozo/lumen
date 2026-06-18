import { describe, it, expect } from 'vitest';
import { dbConnectionConfigSchema } from './connection-contracts';

const valid = {
  host: 'db.example.com',
  port: 3306,
  databaseName: 'shop',
  username: 'lumen_ro',
  password: 's3cret',
  sslEnabled: true,
};

describe('dbConnectionConfigSchema', () => {
  it('accepts a valid config and defaults sslEnabled to true', () => {
    const parsed = dbConnectionConfigSchema.parse({ ...valid, sslEnabled: undefined });
    expect(parsed.sslEnabled).toBe(true);
    expect(parsed.port).toBe(3306);
  });

  it('rejects an out-of-range port and empty fields', () => {
    expect(dbConnectionConfigSchema.safeParse({ ...valid, port: 0 }).success).toBe(false);
    expect(dbConnectionConfigSchema.safeParse({ ...valid, port: 70000 }).success).toBe(false);
    expect(dbConnectionConfigSchema.safeParse({ ...valid, host: '' }).success).toBe(false);
    expect(dbConnectionConfigSchema.safeParse({ ...valid, password: '' }).success).toBe(false);
  });

  it('rejects unknown fields (.strict) — e.g. a client-supplied org_id or id', () => {
    expect(dbConnectionConfigSchema.safeParse({ ...valid, orgId: 'x' }).success).toBe(false);
    expect(dbConnectionConfigSchema.safeParse({ ...valid, id: 'x' }).success).toBe(false);
  });
});
