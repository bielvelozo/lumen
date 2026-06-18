import type { Env } from '@lumen/shared';
import { createKeyring } from './keyring';
import { createEncryptionService, type EncryptionService } from './encryption';
import { generateToken, hashToken, verifyTokenHash, tokenFreshness } from './tokens';
import { hashPassword, verifyPassword } from './passwords';

export * from './errors';
export * from './keyring';
export * from './encryption';
export * from './tokens';
export * from './passwords';

/**
 * The crypto module surface every consumer uses (specs 03/04/05/08/11). No module
 * outside `apps/api/src/crypto/` imports `node:crypto` or `@node-rs/argon2`
 * directly — they all go through an instance of this, so the crypto is written and
 * audited once.
 */
export interface CryptoModule extends EncryptionService {
  generateToken: typeof generateToken;
  hashToken: typeof hashToken;
  verifyTokenHash: typeof verifyTokenHash;
  tokenFreshness: typeof tokenFreshness;
  hashPassword: typeof hashPassword;
  verifyPassword: typeof verifyPassword;
}

/**
 * Build the crypto module from the validated environment. The master key is read
 * ONCE here, into the keyring — the only state in the module. Everything else is a
 * pure function. Bind this at API startup and inject the result wherever a secret
 * must be encrypted, a token hashed, or a password verified.
 */
export function createCryptoModule(env: Pick<Env, 'SECRETS_ENCRYPTION_KEY'>): CryptoModule {
  const keyring = createKeyring(env.SECRETS_ENCRYPTION_KEY);
  const { encrypt, decrypt } = createEncryptionService(keyring);
  return {
    encrypt,
    decrypt,
    generateToken,
    hashToken,
    verifyTokenHash,
    tokenFreshness,
    hashPassword,
    verifyPassword,
  };
}
