import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './passwords';

describe('password hashing (argon2id)', () => {
  it('produces a verifiable argon2id PHC string', async () => {
    const phc = await hashPassword('correct horse battery staple');
    expect(phc.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', phc)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const phc = await hashPassword('s3cret-pw');
    expect(await verifyPassword('not-the-password', phc)).toBe(false);
  });

  it('uses a per-hash salt (same password -> different hashes)', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    // ...but both still verify.
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('returns false (never throws) for a malformed stored hash', async () => {
    expect(await verifyPassword('anything', 'not-a-phc-string')).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
  });
});
