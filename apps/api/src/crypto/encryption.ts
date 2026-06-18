import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { CryptoError } from './errors';
import type { Keyring } from './keyring';

/**
 * Encryption at rest for `bytea` secrets (`db_connections.encrypted_password`,
 * `ai_connections.encrypted_api_key`) — constitution invariant 2. AES-256-GCM with
 * a fresh random IV per call and an authenticated tag, in a self-describing blob:
 *
 *     version(1B) ‖ key_id(1B) ‖ iv(12B) ‖ auth_tag(16B) ‖ ciphertext
 *
 * The leading `version`/`key_id` let a future key rotation decrypt old blobs while
 * writing new ones under a new key, without a format change. `decrypt` verifies the
 * tag, so any tamper or truncation throws — it never returns partial plaintext.
 */
export interface EncryptionService {
  /** Encrypt a UTF-8 string into a blob suitable for a `bytea` column. */
  encrypt(plaintext: string): Buffer;
  /** Decrypt a blob produced by {@link encrypt}; throws on tamper/truncation. */
  decrypt(blob: Buffer): string;
}

const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
// Header = version(1) + key_id(1) + iv(12) = 14 bytes; the 16-byte auth tag follows,
// then the ciphertext. A valid blob is therefore at least header + tag = 30 bytes.
const HEADER_LENGTH = 2 + IV_LENGTH;
const MIN_BLOB_LENGTH = HEADER_LENGTH + TAG_LENGTH;

/**
 * Build an {@link EncryptionService} bound to a {@link Keyring}. New blobs are
 * written under the keyring's `activeKeyId`; decryption selects the key named by
 * each blob's `key_id` byte.
 */
export function createEncryptionService(keyring: Keyring): EncryptionService {
  const writeKeyId = keyring.activeKeyId;

  function encrypt(plaintext: string): Buffer {
    const key = keyring.get(writeKeyId);
    const iv = randomBytes(IV_LENGTH);
    const header = Buffer.from([VERSION, writeKeyId]);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    // Bind the version|key_id header as AAD so the auth tag covers it — a swapped `key_id`
    // (e.g. a rotation-era downgrade) then fails the tag instead of being silently honored.
    cipher.setAAD(header);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([header, iv, authTag, ciphertext]);
  }

  function decrypt(blob: Buffer): string {
    if (!Buffer.isBuffer(blob) || blob.length < MIN_BLOB_LENGTH) {
      throw new CryptoError('MALFORMED_BLOB');
    }
    if (blob.readUInt8(0) !== VERSION) {
      throw new CryptoError('MALFORMED_BLOB');
    }
    const keyId = blob.readUInt8(1);
    const iv = blob.subarray(2, 2 + IV_LENGTH);
    const authTag = blob.subarray(HEADER_LENGTH, HEADER_LENGTH + TAG_LENGTH);
    const ciphertext = blob.subarray(HEADER_LENGTH + TAG_LENGTH);

    const key = keyring.tryGet(keyId);
    if (!key) throw new CryptoError('UNKNOWN_KEY_ID');

    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    // Must match the AAD bound at encrypt time (the version|key_id header) — a tampered header
    // fails the tag here.
    decipher.setAAD(blob.subarray(0, 2));
    decipher.setAuthTag(authTag);
    try {
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    } catch {
      // Auth-tag mismatch (tampered/corrupt) — never surface the bytes.
      throw new CryptoError('DECRYPT_AUTH_FAILED');
    }
  }

  return { encrypt, decrypt };
}
