import { describe, it, expect } from 'vitest';
import { createKeyring } from './keyring';
import { createEncryptionService } from './encryption';
import { CryptoError } from './errors';

const KEY = Buffer.alloc(32, 0x11).toString('base64');
const keyring = createKeyring(KEY);
const { encrypt, decrypt } = createEncryptionService(keyring);

/** Flip every bit of one byte in place (mutates the buffer to simulate tampering). */
function flipByte(buf: Buffer, index: number): void {
  buf.writeUInt8(buf.readUInt8(index) ^ 0xff, index);
}

describe('encryption (AES-256-GCM)', () => {
  it('round-trips a secret', () => {
    const blob = encrypt('hunter2');
    expect(Buffer.isBuffer(blob)).toBe(true);
    expect(decrypt(blob)).toBe('hunter2');
  });

  it('round-trips empty and unicode plaintext', () => {
    expect(decrypt(encrypt(''))).toBe('');
    const unicode = 'café — 日本語 — 🔐';
    expect(decrypt(encrypt(unicode))).toBe(unicode);
  });

  it('emits the documented blob layout (version, key_id, header length)', () => {
    const blob = encrypt('x');
    // version(1) + key_id(1) + iv(12) + tag(16) = 30-byte header, then ciphertext.
    expect(blob.readUInt8(0)).toBe(1); // version
    expect(blob.readUInt8(1)).toBe(0); // active key_id
    expect(blob.length).toBeGreaterThanOrEqual(30);
  });

  it('uses a fresh IV per call (same plaintext -> different blobs)', () => {
    const a = encrypt('same');
    const b = encrypt('same');
    expect(a.equals(b)).toBe(false);
    // IV occupies bytes [2, 14); it must differ between the two encryptions.
    expect(a.subarray(2, 14).equals(b.subarray(2, 14))).toBe(false);
  });

  it('rejects a tampered ciphertext byte', () => {
    const blob = encrypt('secret-value');
    flipByte(blob, blob.length - 1); // flip a ciphertext bit
    expect(() => decrypt(blob)).toThrow(CryptoError);
    expect(() => decrypt(blob)).toThrow(/DECRYPT_AUTH_FAILED/);
  });

  it('rejects a tampered auth tag', () => {
    const blob = encrypt('secret-value');
    flipByte(blob, 20); // a byte inside the auth tag (offset 14..30)
    expect(() => decrypt(blob)).toThrow(/DECRYPT_AUTH_FAILED/);
  });

  it('rejects a tampered IV', () => {
    const blob = encrypt('secret-value');
    flipByte(blob, 3); // a byte inside the IV (offset 2..14)
    expect(() => decrypt(blob)).toThrow(/DECRYPT_AUTH_FAILED/);
  });

  it('rejects a truncated blob with MALFORMED_BLOB', () => {
    const blob = encrypt('secret-value');
    expect(() => decrypt(blob.subarray(0, 20))).toThrow(/MALFORMED_BLOB/);
    expect(() => decrypt(Buffer.alloc(0))).toThrow(/MALFORMED_BLOB/);
  });

  it('rejects an unknown version byte with MALFORMED_BLOB', () => {
    const blob = encrypt('secret-value');
    blob.writeUInt8(2, 0);
    expect(() => decrypt(blob)).toThrow(/MALFORMED_BLOB/);
  });

  it('rejects a blob referencing an unknown key id', () => {
    const blob = encrypt('secret-value');
    blob.writeUInt8(7, 1); // key_id byte -> not in keyring
    expect(() => decrypt(blob)).toThrow(/UNKNOWN_KEY_ID/);
  });

  it('never leaks plaintext through a thrown error', () => {
    const blob = encrypt('top-secret-plaintext');
    flipByte(blob, blob.length - 1);
    try {
      decrypt(blob);
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toBe('DECRYPT_AUTH_FAILED');
      expect(message).not.toContain('top-secret-plaintext');
    }
  });
});
