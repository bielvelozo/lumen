import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VerifyEmailStatus } from '@lumen/shared';
import { createVerificationService } from './verification.service';
import type { VerificationStore, VerificationUser } from './verification.store';
import type { EmailSender, EmailMessage } from './email-sender';
import type { RateLimiter } from './rate-limiter';
import { generateToken, hashToken } from '../crypto';

const NOW = new Date('2026-06-18T12:00:00Z');

interface BuildOpts {
  findUser?: VerificationUser | null;
  consumeResult?: VerifyEmailStatus;
  rateLimited?: boolean;
  sendThrows?: boolean;
}

function build(opts: BuildOpts = {}) {
  const issue = vi.fn(async (_userId: string, _tokenHash: string, _expiresAt: Date) => {});
  const consume = vi.fn(
    async (_tokenHash: string, _now: Date): Promise<VerifyEmailStatus> =>
      opts.consumeResult ?? 'verified',
  );
  const findUserByEmail = vi.fn(
    async (_email: string): Promise<VerificationUser | null> => opts.findUser ?? null,
  );
  const store: VerificationStore = { issue, consume, findUserByEmail };

  const send = vi.fn(async (_message: EmailMessage) => {
    if (opts.sendThrows) throw new Error('resend boom');
  });
  const emailSender: EmailSender = { send };

  const rlConsume = vi.fn((_key: string) => !(opts.rateLimited ?? false));
  const rateLimiter: RateLimiter = { consume: rlConsume };

  const service = createVerificationService({
    store,
    emailSender,
    rateLimiter,
    generateToken,
    hashToken,
    appUrl: 'https://app.test',
    now: () => NOW,
  });
  return { service, issue, consume, findUserByEmail, send, rlConsume };
}

/** Pull the raw token out of the verify link inside a sent message. */
function rawTokenFrom(message: EmailMessage): string {
  const match = message.text.match(/verify-email\?token=([^\s]+)/);
  if (!match?.[1]) throw new Error('no verify link in email');
  return decodeURIComponent(match[1]);
}

describe('verification service — issue', () => {
  it('persists ONLY the hash; the raw token equals sha256-preimage of the stored hash', async () => {
    const { service, issue, send } = build();
    await service.triggerForNewUser('user-1', 'owner@example.com');

    expect(send).toHaveBeenCalledTimes(1);
    expect(issue).toHaveBeenCalledTimes(1);

    const sent = send.mock.calls[0]?.[0];
    const issued = issue.mock.calls[0];
    expect(sent).toBeDefined();
    expect(issued).toBeDefined();
    const raw = rawTokenFrom(sent as EmailMessage);
    const [userId, tokenHash, expiresAt] = issued as [string, string, Date];

    expect(userId).toBe('user-1');
    // GUARD (invariant 4): stored value is the hash, not the raw token.
    expect(tokenHash).toBe(hashToken(raw));
    expect(tokenHash).not.toBe(raw);
    // 24h TTL from the injected clock.
    expect(expiresAt.getTime()).toBe(NOW.getTime() + 24 * 60 * 60 * 1000);
  });

  it('never logs the raw token', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { service, send } = build();
    await service.triggerForNewUser('user-1', 'owner@example.com');
    const raw = rawTokenFrom(send.mock.calls[0]?.[0] as EmailMessage);

    const logged = [...infoSpy.mock.calls, ...warnSpy.mock.calls, ...logSpy.mock.calls]
      .flat()
      .join(' ');
    expect(logged).not.toContain(raw);
  });

  it('swallows a send failure (signup must not hard-fail)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { service } = build({ sendThrows: true });
    await expect(service.triggerForNewUser('user-1', 'owner@example.com')).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('verification service — verifyEmail', () => {
  it('hashes the link token and passes the HASH (not the raw) to consume', async () => {
    const { service, consume } = build({ consumeResult: 'verified' });
    const result = await service.verifyEmail('raw-token-from-link');
    expect(result).toBe('verified');
    const arg = consume.mock.calls[0]?.[0];
    expect(arg).toBe(hashToken('raw-token-from-link'));
    expect(arg).not.toBe('raw-token-from-link');
  });

  it('returns the store outcome verbatim (already_verified / invalid)', async () => {
    expect(await build({ consumeResult: 'already_verified' }).service.verifyEmail('x')).toBe(
      'already_verified',
    );
    expect(await build({ consumeResult: 'invalid' }).service.verifyEmail('x')).toBe('invalid');
  });
});

describe('verification service — resend (anti-enumeration)', () => {
  it('returns an identical generic response for existing, already-verified, and unknown', async () => {
    const existing = build({ findUser: { id: 'u', emailVerified: false } });
    const verified = build({ findUser: { id: 'u', emailVerified: true } });
    const unknown = build({ findUser: null });

    const r1 = await existing.service.resendVerification('a@x.com');
    const r2 = await verified.service.resendVerification('a@x.com');
    const r3 = await unknown.service.resendVerification('a@x.com');

    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
    // Email sent ONLY for the existing-unverified case.
    expect(existing.send).toHaveBeenCalledTimes(1);
    expect(verified.send).not.toHaveBeenCalled();
    expect(unknown.send).not.toHaveBeenCalled();
  });

  it('rate-limited: no lookup, no send, same generic response', async () => {
    const { service, findUserByEmail, send } = build({ rateLimited: true });
    const res = await service.resendVerification('a@x.com');
    expect(res.message).toBeTruthy();
    expect(findUserByEmail).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.restoreAllMocks();
});
