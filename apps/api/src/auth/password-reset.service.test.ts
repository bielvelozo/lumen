import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPasswordResetService } from './password-reset.service';
import type { PasswordResetStore } from './password-reset.store';
import type { EmailSender, EmailMessage } from './email-sender';
import type { RateLimiter } from './rate-limiter';
import { generateToken, hashToken } from '../crypto';

const NOW = new Date('2026-06-18T12:00:00Z');
const USER = '11111111-1111-1111-1111-111111111111';

interface BuildOpts {
  userId?: string | null;
  consumed?: boolean;
  rateLimited?: boolean;
  sendThrows?: boolean;
}

function build(opts: BuildOpts = {}) {
  const findUserIdByEmail = vi.fn(async (_email: string) =>
    opts.userId === undefined ? USER : opts.userId,
  );
  const issue = vi.fn(async (_userId: string, _tokenHash: string, _expiresAt: Date) => {});
  const consume = vi.fn(async (_tokenHash: string, _now: Date, _hash: string) => opts.consumed ?? true);
  const store: PasswordResetStore = { findUserIdByEmail, issue, consume };

  const send = vi.fn(async (_message: EmailMessage) => {
    if (opts.sendThrows) throw new Error('resend boom');
  });
  const emailSender: EmailSender = { send };

  const rlConsume = vi.fn((_key: string) => !(opts.rateLimited ?? false));
  const rateLimiter: RateLimiter = { consume: rlConsume };

  const hashPassword = vi.fn(async (plain: string) => `argon2:${plain}`);

  const service = createPasswordResetService({
    store,
    emailSender,
    rateLimiter,
    generateToken,
    hashToken,
    hashPassword,
    appUrl: 'https://app.test',
    now: () => NOW,
  });
  return { service, findUserIdByEmail, issue, consume, send, rlConsume, hashPassword };
}

/** Pull the raw token out of the reset link inside a sent message. */
function rawTokenFrom(message: EmailMessage): string {
  const match = /reset-password\?token=([^"\s<]+)/.exec(message.text);
  if (!match?.[1]) throw new Error('no reset link in the message');
  return decodeURIComponent(match[1]);
}

const spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  spies.push(vi.spyOn(console, 'warn').mockImplementation(() => {}));
});
afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

describe('requestReset', () => {
  it('stores only the HASH and emails the raw token (invariant 4)', async () => {
    const t = build();
    await t.service.requestReset('dono@empresa.com.br');

    const [, tokenHash, expiresAt] = t.issue.mock.calls[0]!;
    const raw = rawTokenFrom(t.send.mock.calls[0]![0]);
    expect(tokenHash).toBe(hashToken(raw));
    expect(tokenHash).not.toBe(raw);
    expect(expiresAt.getTime()).toBe(NOW.getTime() + 60 * 60 * 1000); // 1h
  });

  it('answers the SAME generic body for a known and an unknown address', async () => {
    const known = build();
    const unknown = build({ userId: null });

    const a = await known.service.requestReset('dono@empresa.com.br');
    const b = await unknown.service.requestReset('ninguem@empresa.com.br');

    expect(a).toEqual(b);
    expect(unknown.issue).not.toHaveBeenCalled();
    expect(unknown.send).not.toHaveBeenCalled();
  });

  it('is rate-limited per email, still with the same body and no token issued', async () => {
    const t = build({ rateLimited: true });
    const response = await t.service.requestReset('dono@empresa.com.br');

    expect(response.message).toContain('Se existir uma conta');
    expect(t.rlConsume).toHaveBeenCalledWith('dono@empresa.com.br');
    expect(t.findUserIdByEmail).not.toHaveBeenCalled();
    expect(t.issue).not.toHaveBeenCalled();
  });

  it('swallows a send failure and logs nothing that carries the link', async () => {
    const t = build({ sendThrows: true });
    const warn = vi.spyOn(console, 'warn');

    await expect(t.service.requestReset('dono@empresa.com.br')).resolves.toBeDefined();

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).not.toContain('reset-password?token=');
  });
});

describe('resetPassword', () => {
  it('hashes the presented token and the new password, then consumes', async () => {
    const t = build();
    await expect(t.service.resetPassword('raw-token', 'uma-senha-boa-9')).resolves.toBe(true);

    const [tokenHash, , passwordHash] = t.consume.mock.calls[0]!;
    expect(tokenHash).toBe(hashToken('raw-token'));
    expect(passwordHash).toBe('argon2:uma-senha-boa-9'); // never the plaintext
  });

  it('returns false for a token the store refuses (unknown / expired / already spent)', async () => {
    const t = build({ consumed: false });
    await expect(t.service.resetPassword('stale', 'uma-senha-boa-9')).resolves.toBe(false);
  });
});
