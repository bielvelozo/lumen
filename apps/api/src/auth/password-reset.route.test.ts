import { describe, it, expect, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import type { PasswordResetService } from './password-reset.service';

const GENERIC = { message: 'Se existir uma conta com esse e-mail, enviamos um link.' };

function appWith(resetOk = true) {
  const requestReset = vi.fn(async () => GENERIC);
  const resetPassword = vi.fn(async () => resetOk);
  const service: PasswordResetService = { requestReset, resetPassword };
  return { app: buildApp({ passwordResetService: service }), requestReset, resetPassword };
}

let app: FastifyInstance | undefined;
afterEach(async () => {
  if (app) await app.close();
  app = undefined;
});

describe('POST /auth/forgot-password', () => {
  it('202s with the generic body and normalizes the email', async () => {
    const built = appWith();
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: '  Dono@Empresa.com.BR ' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual(GENERIC);
    expect(built.requestReset).toHaveBeenCalledWith('dono@empresa.com.br');
  });

  it('rejects a malformed email with 400 and an unknown field (.strict) with 400', async () => {
    const built = appWith();
    app = built.app;
    const bad = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'not-an-email' },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe('ValidationError');

    const extra = await app.inject({
      method: 'POST',
      url: '/auth/forgot-password',
      payload: { email: 'dono@empresa.com.br', userId: 'u1' },
    });
    expect(extra.statusCode).toBe(400);
    expect(built.requestReset).not.toHaveBeenCalled();
  });
});

describe('POST /auth/reset-password', () => {
  it('200 { ok: true } when the token is consumed', async () => {
    const built = appWith(true);
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: 'raw-token', password: 'uma-senha-boa-9' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(built.resetPassword).toHaveBeenCalledWith('raw-token', 'uma-senha-boa-9');
  });

  it('400 for an unusable link, without saying which of the three reasons it was', async () => {
    const built = appWith(false);
    app = built.app;
    const res = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: 'stale', password: 'uma-senha-boa-9' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'InvalidResetToken' });
  });

  it('holds the new password to the SAME policy as signup', async () => {
    const built = appWith();
    app = built.app;
    const short = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: 'raw-token', password: 'curta' },
    });
    expect(short.statusCode).toBe(400);

    const common = await app.inject({
      method: 'POST',
      url: '/auth/reset-password',
      payload: { token: 'raw-token', password: 'password123' },
    });
    expect(common.statusCode).toBe(400);
    expect(built.resetPassword).not.toHaveBeenCalled();
  });
});
