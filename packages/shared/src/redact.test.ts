import { describe, it, expect } from 'vitest';
import {
  redactSensitive,
  isSensitiveKey,
  findSensitiveLeaf,
  redactSecretStrings,
  scrubSentryEvent,
  REDACTED,
} from './redact';
import { auditQuerySchema } from './audit-contracts';

describe('isSensitiveKey', () => {
  it('matches secrets / credentials / tokens / cookies / PII (case-insensitive substring)', () => {
    for (const k of ['password', 'encrypted_api_key', 'apiKey', 'token_hash', 'Authorization', 'Cookie', 'set-cookie', 'email', 'JWT_SECRET']) {
      expect(isSensitiveKey(k)).toBe(true);
    }
  });
  it('catches hyphenated / separator forms that a naive substring would miss (Gate-1 F2)', () => {
    for (const k of ['x-api-key', 'api-key', 'X-Auth-Token', 'private-key', 'proxy-authorization']) {
      expect(isSensitiveKey(k)).toBe(true);
    }
  });
  it('does not match benign keys (functionName/tableName survive)', () => {
    for (const k of ['functionName', 'tableName', 'status', 'durationMs', 'table', 'bucket', 'value']) {
      expect(isSensitiveKey(k)).toBe(false);
    }
  });
});

describe('redactSecretStrings — secret-shaped substrings (Gate-1 F2/F5)', () => {
  it('redacts an API key / bearer token / DSN embedded inside a free string', () => {
    expect(redactSecretStrings('error using key sk-ant-abc123_XYZ here')).toContain(REDACTED);
    expect(redactSecretStrings('Authorization: Bearer eyJ.abc.def')).toContain(REDACTED);
    expect(redactSecretStrings('connect failed: mysql://root:hunter2@db:3306/shop')).toContain(REDACTED);
    expect(redactSecretStrings('connect failed: mysql://root:hunter2@db:3306/shop')).not.toContain('hunter2');
  });
  it('leaves a benign string untouched', () => {
    expect(redactSecretStrings('aggregate_over_time on orders')).toBe('aggregate_over_time on orders');
  });
});

describe('redactSensitive — extra defenses', () => {
  it('redacts an x-api-key value anywhere (Gate-1 F2)', () => {
    const r = redactSensitive({ headers: { 'x-api-key': 'sk-ant-secret' } }) as { headers: Record<string, unknown> };
    expect(r.headers['x-api-key']).toBe(REDACTED);
  });
  it('redacts a secret embedded in an error message string', () => {
    const r = redactSensitive({ exception: { value: 'failed: sk-ant-leak' } }) as { exception: { value: string } };
    expect(r.exception.value).toContain(REDACTED);
    expect(r.exception.value).not.toContain('sk-ant-leak');
  });
  it('drops prototype-polluting keys (Gate-1 M)', () => {
    const malicious = JSON.parse('{"__proto__":{"polluted":true},"ok":1}');
    const r = redactSensitive(malicious) as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(r.ok).toBe(1);
  });
});

describe('scrubSentryEvent — drops headers/body/query/cookies wholesale (Gate-1 F1)', () => {
  it('removes the entire request headers object (no x-api-key/cookie/authorization survives)', () => {
    const e = scrubSentryEvent({
      server_name: 'host-01',
      request: {
        data: { q: 'x' },
        query_string: 'token=sk-ant-x',
        cookies: { a: 'b' },
        headers: { 'x-api-key': 'sk-ant-secret', cookie: 'jwt', 'content-type': 'application/json' },
      },
    });
    expect(e.request?.headers).toBeUndefined();
    expect(e.request?.data).toBeUndefined();
    expect(e.request?.query_string).toBeUndefined();
    expect(e.request?.cookies).toBeUndefined();
    expect(e.server_name).toBeUndefined();
    expect(JSON.stringify(e)).not.toContain('sk-ant-secret');
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
