import { CryptoError } from './errors';

/** AES-256 key length in bytes. */
const KEY_LENGTH = 32;

/**
 * A keyring maps a one-byte `key_id` to a 32-byte AES key. v1 holds a single key
 * (active id `0`) loaded from `SECRETS_ENCRYPTION_KEY`; the abstraction exists so a
 * future key rotation (spec 16) becomes a config change — add a second key here and
 * old blobs still decrypt under their original `key_id` — never a format change.
 * The keys live only in process memory; they are never logged or persisted.
 */
export interface Keyring {
  /** The `key_id` new blobs are encrypted under. */
  readonly activeKeyId: number;
  /** Return the key for `keyId`, or throw `UNKNOWN_KEY_ID` if absent. */
  get(keyId: number): Buffer;
  /** Return the key for `keyId`, or `undefined` if absent (no throw). */
  tryGet(keyId: number): Buffer | undefined;
}

/**
 * Build a keyring from a base64-encoded master key. The key MUST decode to exactly
 * 32 bytes (the shared env schema already enforces this at boot; this is
 * defense-in-depth). On any length mismatch we throw `KEY_INVALID` — and the error
 * never contains the key or its bytes.
 *
 * @param masterKeyBase64 base64 (standard) encoding of a 32-byte key
 * @param activeKeyId one-byte id the key is registered under (default `0`)
 */
export function createKeyring(masterKeyBase64: string, activeKeyId = 0): Keyring {
  if (!Number.isInteger(activeKeyId) || activeKeyId < 0 || activeKeyId > 255) {
    throw new CryptoError('KEY_INVALID');
  }
  const key = decodeKey(masterKeyBase64);
  const keys = new Map<number, Buffer>([[activeKeyId, key]]);

  return {
    activeKeyId,
    get(keyId: number): Buffer {
      const found = keys.get(keyId);
      if (!found) throw new CryptoError('UNKNOWN_KEY_ID');
      return found;
    },
    tryGet(keyId: number): Buffer | undefined {
      return keys.get(keyId);
    },
  };
}

/** Decode + length-validate a master key. Never include the key in the error. */
function decodeKey(masterKeyBase64: string): Buffer {
  const buffer = Buffer.from(masterKeyBase64, 'base64');
  if (buffer.length !== KEY_LENGTH) {
    throw new CryptoError('KEY_INVALID');
  }
  return buffer;
}
