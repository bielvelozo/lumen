import { describe, it, expect } from 'vitest';
import { parseEnv, EnvValidationError } from './env';

const validEnv: Record<string, string | undefined> = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/lumen',
  MYSQL_URL: 'mysql://user:pass@localhost:3306/lumen_client',
  SECRETS_ENCRYPTION_KEY: 'A'.repeat(44),
  JWT_SECRET: 'B'.repeat(64),
};

describe('parseEnv', () => {
  it('parses a valid environment and applies defaults', () => {
    const env = parseEnv(validEnv);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3001);
    expect(env.RESEND_API_KEY).toBe('');
  });

  it('coerces PORT to a number', () => {
    const env = parseEnv({ ...validEnv, PORT: '4000' });
    expect(env.PORT).toBe(4000);
  });

  it('throws a readable error naming a missing required var', () => {
    const missing: Record<string, string | undefined> = { ...validEnv };
    missing.DATABASE_URL = undefined;
    expect(() => parseEnv(missing)).toThrow(EnvValidationError);
    try {
      parseEnv(missing);
      expect.unreachable('parseEnv should have thrown');
    } catch (error) {
      expect((error as Error).message).toContain('DATABASE_URL');
    }
  });

  it('rejects an invalid connection URL', () => {
    expect(() => parseEnv({ ...validEnv, MYSQL_URL: 'not-a-url' })).toThrow(/MYSQL_URL/);
  });
});
