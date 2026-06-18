import { describe, it, expect } from 'vitest';
import { createKeyring } from './keyring';
import { CryptoError } from './errors';

const VALID_KEY = Buffer.alloc(32, 0x2a).toString('base64'); // 32 bytes -> base64

describe('createKeyring', () => {
  it('builds a keyring from a valid 32-byte base64 key', () => {
    const keyring = createKeyring(VALID_KEY);
    expect(keyring.activeKeyId).toBe(0);
    expect(keyring.get(0)).toHaveLength(32);
    expect(keyring.tryGet(0)).toHaveLength(32);
  });

  it('throws KEY_INVALID for a key that is not 32 bytes', () => {
    const short = Buffer.alloc(16, 1).toString('base64');
    const long = Buffer.alloc(48, 1).toString('base64');
    expect(() => createKeyring(short)).toThrow(CryptoError);
    expect(() => createKeyring(short)).toThrow(/KEY_INVALID/);
    expect(() => createKeyring(long)).toThrow(/KEY_INVALID/);
  });

  it('never leaks the key bytes through the error', () => {
    const short = Buffer.from('abcd').toString('base64');
    try {
      createKeyring(short);
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toBe('KEY_INVALID');
      expect(message).not.toContain(short);
      expect(message).not.toContain('abcd');
    }
  });

  it('returns undefined / throws for an unknown key id', () => {
    const keyring = createKeyring(VALID_KEY);
    expect(keyring.tryGet(9)).toBeUndefined();
    expect(() => keyring.get(9)).toThrow(/UNKNOWN_KEY_ID/);
  });

  it('rejects an out-of-range active key id', () => {
    expect(() => createKeyring(VALID_KEY, 256)).toThrow(/KEY_INVALID/);
    expect(() => createKeyring(VALID_KEY, -1)).toThrow(/KEY_INVALID/);
  });
});
