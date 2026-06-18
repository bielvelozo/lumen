/**
 * Safe, non-revealing reason codes for failures in the crypto module. A
 * {@link CryptoError} carries ONLY one of these — never plaintext, ciphertext
 * bytes, a key, a token, or a password. This is the "no secret in logs, ever"
 * guarantee from spec 02 (constitution invariants 2 & 4): the message a caller,
 * a log, or Sentry sees is the code itself, nothing more.
 */
export type CryptoErrorCode =
  /** Blob is too short, has an unknown version byte, or is otherwise unparseable. */
  | 'MALFORMED_BLOB'
  /** AES-GCM auth-tag verification failed — tampered/corrupted ciphertext. */
  | 'DECRYPT_AUTH_FAILED'
  /** Blob references a `key_id` not present in the keyring. */
  | 'UNKNOWN_KEY_ID'
  /** Master key is missing or not exactly 32 bytes after base64 decode. */
  | 'KEY_INVALID';

/**
 * The only error type the crypto module throws. Its `message` is exactly the
 * reason `code`; it never embeds the offending bytes. Callers may branch on
 * `code` but must never log anything else about the failure.
 */
export class CryptoError extends Error {
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode) {
    super(code);
    this.name = 'CryptoError';
    this.code = code;
  }
}
