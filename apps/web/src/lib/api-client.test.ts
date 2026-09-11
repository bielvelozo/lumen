import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, ApiError } from './api-client';
import { signup, login, fetchMe } from './api';

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiFetch', () => {
  it('always sends credentials:include; the JSON content-type travels only with a body', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ status: 'ok' }));
    await apiFetch('/health');
    const bare = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(bare.credentials).toBe('include');
    expect(bare.headers).toBeUndefined();
    expect(bare.body).toBeUndefined();

    fetchMock.mockResolvedValueOnce(okJson({ id: 's1' }));
    await apiFetch('/chat/sessions', { method: 'POST' });
    const bodyless = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(bodyless.headers).toBeUndefined();

    fetchMock.mockResolvedValueOnce(okJson({ ok: true }));
    await apiFetch('/auth/login', { method: 'POST', body: { email: 'a@b.com', password: 'x' } });
    const withBody = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect((withBody.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(withBody.body).toBe(JSON.stringify({ email: 'a@b.com', password: 'x' }));
  });

  it('throws ApiError carrying the status + body on a non-2xx', async () => {
    fetchMock.mockResolvedValueOnce(okJson({ error: 'InvalidCredentials' }, 401));
    await expect(apiFetch('/auth/me')).rejects.toBeInstanceOf(ApiError);
    fetchMock.mockResolvedValueOnce(okJson({ error: 'InvalidCredentials' }, 401));
    const err = await apiFetch('/auth/me').catch((e: unknown) => e);
    expect((err as ApiError).status).toBe(401);
  });
});

describe('anti-IDOR: no request ever carries an org_id', () => {
  it('signup / login / me send no org_id in the URL or body', async () => {
    fetchMock.mockImplementation(async () => okJson({ ok: true }));
    await signup({ email: 'a@b.com', password: 'a-strong-pass-9', organizationName: 'Acme' });
    await login({ email: 'a@b.com', password: 'a-strong-pass-9' });
    await fetchMe();

    for (const call of fetchMock.mock.calls) {
      const url = String(call[0]);
      const init = (call[1] ?? {}) as RequestInit;
      const serialized = `${url} ${typeof init.body === 'string' ? init.body : ''}`;
      expect(serialized).not.toMatch(/org_id|orgId/i);
      // organizationName is fine (it's the business name, not a tenant id).
    }
    // every request still carried the cookie
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).credentials).toBe('include');
    }
  });
});
