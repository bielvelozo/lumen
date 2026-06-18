import { describe, it, expect } from 'vitest';
import { REDACTED } from '@lumen/shared';
import { scrubEvent, scrubBreadcrumb } from './scrubber';
import { makeRequestId } from './request-id';
import { initSentry } from './sentry';

describe('scrubEvent — a fully-poisoned event is sanitized', () => {
  it('strips body/query/cookies and redacts secrets/headers/PII/sample rows', () => {
    const poisoned = {
      message: 'query failed',
      server_name: 'api-host-01',
      request: {
        method: 'POST',
        url: 'https://api/chat',
        query_string: 'token=sk-ant-leak',
        cookies: { access: 'jwt-cookie-value' },
        data: { message: 'quanto vendi?', password: 'hunter2' },
        headers: {
          authorization: 'Bearer sk-ant-secret',
          cookie: 'access=jwt',
          'content-type': 'application/json',
        },
      },
      contexts: {
        db: { encrypted_api_key: 'BLOB', sampleRow: { email: 'a@b.com', total: 128000 } },
      },
      extra: { decryptedPassword: 'plaintext-secret' },
    };

    const e = scrubEvent(structuredClone(poisoned));

    // bodies / query / cookies dropped wholesale
    expect(e.request?.data).toBeUndefined();
    expect(e.request?.query_string).toBeUndefined();
    expect(e.request?.cookies).toBeUndefined();
    // sensitive headers redacted; benign header kept
    expect(e.request?.headers?.authorization).toBe(REDACTED);
    expect(e.request?.headers?.cookie).toBe(REDACTED);
    expect(e.request?.headers?.['content-type']).toBe('application/json');
    // server name stripped
    expect(e.server_name).toBeUndefined();
    // secrets / PII redacted deep in contexts/extra
    const db = (e.contexts as Record<string, Record<string, unknown>>).db ?? {};
    expect(db.encrypted_api_key).toBe(REDACTED);
    expect((db.sampleRow as Record<string, unknown>).email).toBe(REDACTED);
    expect((e.extra as Record<string, unknown>).decryptedPassword).toBe(REDACTED);

    // a full serialization must contain none of the secrets / PII
    const json = JSON.stringify(e);
    expect(json).not.toContain('hunter2');
    expect(json).not.toContain('sk-ant-secret');
    expect(json).not.toContain('plaintext-secret');
    expect(json).not.toContain('a@b.com');
    expect(json).not.toContain('jwt-cookie-value');
  });

  it('scrubBreadcrumb redacts a captured body', () => {
    const b = scrubBreadcrumb({ category: 'http', data: { authorization: 'Bearer x', url: '/chat' } });
    expect((b.data as Record<string, unknown>).authorization).toBe(REDACTED);
    expect((b.data as Record<string, unknown>).url).toBe('/chat');
  });
});

describe('request id', () => {
  it('is opaque and encodes no PII', () => {
    const id = makeRequestId();
    expect(id).toMatch(/^req_[0-9a-f]{24}$/);
    expect(makeRequestId()).not.toBe(id); // unique
  });
});

describe('initSentry', () => {
  it('is disabled (returns false) when SENTRY_DSN is absent — local dev boots without it', () => {
    expect(
      initSentry({ SENTRY_DSN: '', SENTRY_ENVIRONMENT: 'development', SENTRY_TRACES_SAMPLE_RATE: 0.1 }),
    ).toBe(false);
  });
});
