import { describe, it, expect } from 'vitest';
import { redactSensitive, isSensitiveKey, findSensitiveLeaf, REDACTED } from './redact';
import { auditQuerySchema } from './audit-contracts';

describe('isSensitiveKey', () => {
  it('matches secrets / credentials / tokens / cookies / PII (case-insensitive substring)', () => {
    for (const k of ['password', 'encrypted_api_key', 'apiKey', 'token_hash', 'Authorization', 'Cookie', 'set-cookie', 'email', 'JWT_SECRET']) {
      expect(isSensitiveKey(k)).toBe(true);
    }
  });
  it('does not match benign keys', () => {
    for (const k of ['functionName', 'status', 'durationMs', 'table', 'bucket', 'value']) {
      expect(isSensitiveKey(k)).toBe(false);
    }
  });
});

describe('redactSensitive', () => {
  it('redacts denylisted keys at any depth, keeps benign values', () => {
    const event = {
      request: {
        headers: { authorization: 'Bearer sk-ant-xxx', cookie: 'access=jwt', 'content-type': 'application/json' },
        data: { password: 'hunter2', message: 'quanto vendi?' },
      },
      extra: { encrypted_api_key: 'BLOB', rows: [{ email: 'a@b.com', total: 128000 }] },
      tags: { requestId: 'req_abc', functionName: 'aggregate_over_time' },
    };
    const r = redactSensitive(event) as typeof event;
    expect(r.request.headers.authorization).toBe(REDACTED);
    expect(r.request.headers.cookie).toBe(REDACTED);
    expect(r.request.headers['content-type']).toBe('application/json');
    expect(r.request.data.password).toBe(REDACTED);
    expect(r.request.data.message).toBe('quanto vendi?'); // benign content preserved
    expect(r.extra.encrypted_api_key).toBe(REDACTED);
    expect((r.extra.rows[0] as Record<string, unknown>).email).toBe(REDACTED);
    expect((r.extra.rows[0] as Record<string, unknown>).total).toBe(128000); // a cell value is not key-sensitive
    expect(r.tags.requestId).toBe('req_abc');
  });

  it('does not mutate the input', () => {
    const input = { password: 'x' };
    redactSensitive(input);
    expect(input.password).toBe('x');
  });

  it('truncates over-deep structures instead of throwing', () => {
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 50; i++) deep = { nested: deep };
    expect(() => redactSensitive(deep)).not.toThrow();
  });
});

describe('findSensitiveLeaf — write-site guard', () => {
  it('flags a denylisted key carrying a real value', () => {
    expect(findSensitiveLeaf({ a: { password: 'hunter2' } })).toBe('a.password');
  });
  it('passes type-tag / redacted leaves (already neutralized)', () => {
    expect(findSensitiveLeaf({ token: 'string', password: REDACTED, email: null })).toBeNull();
  });
  it('passes clean sanitized params', () => {
    expect(findSensitiveLeaf({ table: 'string', metric: { agg: 'string', column: 'string' } })).toBeNull();
  });
});

describe('auditQuerySchema', () => {
  it('coerces page/limit and rejects a smuggled org_id', () => {
    expect(auditQuerySchema.safeParse({ page: '2', limit: '10' }).success).toBe(true);
    expect(auditQuerySchema.safeParse({ orgId: 'x' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ limit: '500' }).success).toBe(false); // over max
  });
});
