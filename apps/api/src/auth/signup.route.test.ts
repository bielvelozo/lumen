import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { createSignupService } from './signup.service';
import type { SignupStore, CreateTenantResult } from './signup.store';

const validBody = {
  email: 'Owner@Example.com',
  password: 'a-strong-pass-9',
  organizationName: 'Acme Ltda',
};

function appWith(outcome: CreateTenantResult = { outcome: 'created', orgId: 'o-1', userId: 'u-1' }) {
  const store: SignupStore = { createTenant: async (): Promise<CreateTenantResult> => outcome };
  const service = createSignupService({
    store,
    hashPassword: async (plain: string) => `argon2:${plain}`,
    verificationTrigger: { triggerForNewUser: async () => {} },
  });
  return buildApp({ signupService: service });
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('POST /auth/signup', () => {
  it('returns 201 with a non-identifying message on valid input', async () => {
    app = appWith();
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: validBody });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.message).toBeTruthy();
    // Never leak identifiers or the password.
    expect(res.payload).not.toContain('o-1');
    expect(res.payload).not.toContain('u-1');
    expect(res.payload).not.toContain('a-strong-pass-9');
    expect(body).not.toHaveProperty('org_id');
    expect(body).not.toHaveProperty('user_id');
  });

  it('a duplicate email returns the SAME 201 response (anti-enumeration)', async () => {
    app = appWith({ outcome: 'duplicate' });
    const res = await app.inject({ method: 'POST', url: '/auth/signup', payload: validBody });
    expect(res.statusCode).toBe(201);

    const freshApp = appWith({ outcome: 'created', orgId: 'o', userId: 'u' });
    const freshRes = await freshApp.inject({ method: 'POST', url: '/auth/signup', payload: validBody });
    await freshApp.close();
    expect(res.json()).toEqual(freshRes.json());
  });

  it('rejects an invalid email with 400 + field error', async () => {
    app = appWith();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { ...validBody, email: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('ValidationError');
    expect(body.fields.email).toMatch(/valid email/i);
  });

  it('rejects a weak password with 400', async () => {
    app = appWith();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { ...validBody, password: 'short1' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields.password).toBeTruthy();
  });

  it('rejects a blank organizationName with 400', async () => {
    app = appWith();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { ...validBody, organizationName: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields.organizationName).toBeTruthy();
  });

  it('rejects unknown fields (.strict) with 400 — e.g. a client-supplied org_id', async () => {
    app = appWith();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: { ...validBody, org_id: 'attacker-supplied' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().formErrors.length).toBeGreaterThan(0);
  });
});
