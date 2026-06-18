import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { VerifyEmailStatus, ResendVerificationResponse } from '@lumen/shared';
import { buildApp } from '../app';
import type { VerificationService } from './verification.service';

const RESEND_BODY: ResendVerificationResponse = { message: 'generic' };

function appWith(verifyResult: VerifyEmailStatus = 'verified') {
  const service: VerificationService = {
    async triggerForNewUser() {},
    async verifyEmail() {
      return verifyResult;
    },
    async resendVerification() {
      return RESEND_BODY;
    },
  };
  return buildApp({ verificationService: service });
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('POST /auth/verify-email', () => {
  it('returns 200 { status: "verified" } for a valid token', async () => {
    app = appWith('verified');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: 'raw-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'verified' });
  });

  it('returns 200 { status: "invalid" } for a garbage token (no 500)', async () => {
    app = appWith('invalid');
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: 'garbage' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'invalid' });
  });

  it('rejects a missing token with 400', async () => {
    app = appWith();
    const res = await app.inject({ method: 'POST', url: '/auth/verify-email', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('ValidationError');
  });

  it('rejects an unknown field (.strict) with 400', async () => {
    app = appWith();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/verify-email',
      payload: { token: 'x', user_id: 'attacker' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /auth/resend-verification', () => {
  it('returns 202 with the generic body and never echoes a token', async () => {
    app = appWith();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/resend-verification',
      payload: { email: 'owner@example.com' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual(RESEND_BODY);
    expect(res.payload).not.toContain('token');
  });

  it('rejects an invalid email with 400', async () => {
    app = appWith();
    const res = await app.inject({
      method: 'POST',
      url: '/auth/resend-verification',
      payload: { email: 'nope' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().fields.email).toBeTruthy();
  });
});
