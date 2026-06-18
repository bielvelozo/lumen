import { describe, it, expect } from 'vitest';
import { signupRequestSchema, PASSWORD_MIN_LENGTH } from './auth-contracts';

const valid = {
  email: 'Owner@Example.com',
  password: 'a-strong-pass-9',
  organizationName: '  Acme Ltda  ',
};

describe('signupRequestSchema', () => {
  it('normalizes email (trim + lowercase) and trims organizationName', () => {
    const parsed = signupRequestSchema.parse({ ...valid, email: '  Owner@Example.com  ' });
    expect(parsed.email).toBe('owner@example.com');
    expect(parsed.organizationName).toBe('Acme Ltda');
    expect(parsed.password).toBe('a-strong-pass-9'); // password left verbatim
  });

  it('rejects an invalid email', () => {
    const r = signupRequestSchema.safeParse({ ...valid, email: 'not-an-email' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.email?.[0]).toMatch(/valid email/i);
  });

  it(`rejects a password shorter than ${PASSWORD_MIN_LENGTH} chars`, () => {
    const r = signupRequestSchema.safeParse({ ...valid, password: 'short1' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.password?.[0]).toMatch(/at least/i);
  });

  it('rejects a common/denylisted password (case-insensitive)', () => {
    const r = signupRequestSchema.safeParse({ ...valid, password: 'Password123' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.password?.[0]).toMatch(/too common/i);
  });

  it('rejects a blank organizationName', () => {
    const r = signupRequestSchema.safeParse({ ...valid, organizationName: '   ' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.flatten().fieldErrors.organizationName?.[0]).toBeTruthy();
  });

  it('rejects unknown fields (.strict) — e.g. a client-supplied org_id', () => {
    const r = signupRequestSchema.safeParse({ ...valid, org_id: 'abc', role: 'owner' });
    expect(r.success).toBe(false);
  });

  it('accepts valid normalized input', () => {
    const r = signupRequestSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });
});
