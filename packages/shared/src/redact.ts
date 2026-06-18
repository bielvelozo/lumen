/**
 * The SINGLE source of truth for "what counts as sensitive" (spec 15). Used by BOTH the Sentry
 * `beforeSend` scrubber AND the `function_call_logs` write-site guard, so the denylist cannot
 * drift between the two doors. A value under any denylisted key is replaced with `[REDACTED]`.
 */

export const REDACTED = '[REDACTED]';

/**
 * Keys whose VALUE must never leave the process — secrets, credentials, tokens, cookies, auth
 * headers, and direct PII. Matched case-insensitively as a substring of the key (so `apiKey`,
 * `encrypted_api_key`, `X-Api-Key` all match `api`-key forms). Kept deliberately broad.
 */
const SENSITIVE_KEY_PARTS = [
  'password',
  'encrypted_password',
  'encryptedpassword',
  'encrypted_api_key',
  'encryptedapikey',
  'api_key',
  'apikey',
  'secret',
  'token',
  'authorization',
  'cookie',
  'set-cookie',
  'email',
  'jwt',
] as const;

/** True if a key names a sensitive value. */
export function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => k.includes(part));
}

const MAX_DEPTH = 8;

/**
 * Deep-redact a value: any property whose KEY is sensitive becomes `[REDACTED]`; everything else
 * is preserved (so debugging context like function names / table identifiers survives). Cycles and
 * over-deep structures are truncated to `[REDACTED]` rather than thrown on. Returns a new value;
 * the input is never mutated.
 */
export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactSensitive(v, depth + 1);
  }
  return out;
}

/**
 * Write-site guard (spec 15): does this already-sanitized value still carry a sensitive leaf —
 * a denylisted key whose value is NOT the redaction marker (and not a type-tag placeholder)? Used
 * to assert at the `function_call_logs` write that no secret survived. Returns the first offending
 * key path, or null if clean.
 */
export function findSensitiveLeaf(value: unknown, path = '', depth = 0): string | null {
  if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findSensitiveLeaf(value[i], `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${key}` : key;
    if (isSensitiveKey(key)) {
      // A sensitive key is only OK if its value was already neutralized (redacted or a type tag).
      const neutral =
        v === REDACTED || v === 'string' || v === 'number' || v === 'boolean' || v === null;
      if (!neutral) return here;
    }
    const deeper = findSensitiveLeaf(v, here, depth + 1);
    if (deeper) return deeper;
  }
  return null;
}
