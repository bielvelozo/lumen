import { describe, it, expect } from 'vitest';
import {
  CONSENT_TERMS,
  CURRENT_CONSENT_VERSION,
  acceptConsentRequestSchema,
  onboardingScriptRequestSchema,
} from './consent-contracts';

describe('consent terms', () => {
  it('pins the four scope points to the current version', () => {
    expect(CONSENT_TERMS.version).toBe(CURRENT_CONSENT_VERSION);
    expect(CONSENT_TERMS.points).toHaveLength(4);
    const joined = CONSENT_TERMS.points.join(' ').toLowerCase();
    expect(joined).toContain('somente leitura'); // read-only
    expect(joined).toContain('criptografada'); // encrypted at rest
    expect(joined).toContain('revogada'); // revocable
  });
});

describe('acceptConsentRequestSchema', () => {
  it('requires a version and rejects unknown fields (no org_id)', () => {
    expect(acceptConsentRequestSchema.safeParse({ consentVersion: '1' }).success).toBe(true);
    expect(acceptConsentRequestSchema.safeParse({}).success).toBe(false);
    expect(
      acceptConsentRequestSchema.safeParse({ consentVersion: '1', orgId: 'x' }).success,
    ).toBe(false);
  });
});

describe('onboardingScriptRequestSchema', () => {
  it('accepts safe identifiers and an optional empty body', () => {
    expect(onboardingScriptRequestSchema.safeParse({}).success).toBe(true);
    expect(
      onboardingScriptRequestSchema.safeParse({ username: 'lumen_ro', databaseName: 'shop' })
        .success,
    ).toBe(true);
  });

  it('rejects identifiers with unsafe characters (injection guard)', () => {
    expect(onboardingScriptRequestSchema.safeParse({ username: "ro'; DROP" }).success).toBe(false);
    expect(onboardingScriptRequestSchema.safeParse({ databaseName: 'a b' }).success).toBe(false);
    expect(onboardingScriptRequestSchema.safeParse({ databaseName: 'a`b' }).success).toBe(false);
  });
});
