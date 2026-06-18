import { describe, it, expect } from 'vitest';
import { EnvValidationError } from '@lumen/shared';
import { loadEnv } from './env';

const completeSource: Record<string, string | undefined> = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/lumen',
  MYSQL_URL: 'mysql://user:pass@localhost:3306/lumen_client',
  // 'A'*43 + '=' is valid base64 for 32 (zero) bytes — a structurally valid key.
  SECRETS_ENCRYPTION_KEY: 'A'.repeat(43) + '=',
  JWT_SECRET: 'B'.repeat(64),
};

describe('loadEnv', () => {
  it('fails fast with a readable error when a required var is missing', () => {
    expect(() => loadEnv({ NODE_ENV: 'test' })).toThrow(EnvValidationError);
  });

  it('returns a validated env for a complete source', () => {
    const env = loadEnv(completeSource);
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3001);
  });
});
