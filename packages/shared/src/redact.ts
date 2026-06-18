/**
 * The SINGLE source of truth for "what counts as sensitive" (spec 15). Used by BOTH the Sentry
 * scrubbers (`scrubSentryEvent`/`scrubSentryBreadcrumb`, API + web) AND the `function_call_logs`
 * write-site guard, so the discipline cannot drift between doors. Defense is layered:
 *   1. key-name redaction (separator-insensitive, so `x-api-key`/`api_key`/`apiKey` all match);
 *   2. secret-PATTERN redaction inside string VALUES (a key/DSN embedded in an error message);
 *   3. wholesale drop of request bodies/query/cookies/HEADERS in the Sentry scrubber.
 */

export const REDACTED = '[REDACTED]';

/**
 * Normalized substrings (no separators) of keys whose VALUE must never leave the process. The key
 * is lowercased and stripped of `-`/`_`/spaces before matching, so `x-api-key` -> `xapikey`
 * matches `apikey`. Deliberately broad on secrets/tokens/credentials/PII; avoids over-broad parts
 * like `name`/`address` that would redact benign identifiers (`functionName`, `tableName`).
 */
const SENSITIVE_KEY_PARTS = [
  'password',
  'apikey',
  'secret',
  'token',
  'authorization',
  'auth',
  'cookie',
  'setcookie',
  'credential',
  'bearer',
  'dsn',
  'privatekey',
  'email',
  'jwt',
  'cpf',
  'cnpj',
  'ssn',
  'phone',
] as const;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

/** True if a key names a sensitive value (separator-insensitive substring match). */
export function isSensitiveKey(key: string): boolean {
  const k = normalizeKey(key);
  return SENSITIVE_KEY_PARTS.some((part) => k.includes(part));
}

// Secret-shaped substrings that must be redacted even under a benign key or inside a free string
// (e.g. a driver error embedding a DSN, or `Authorization: Bearer …` captured as text).
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]+/gi, // Anthropic API keys
  /Bearer\s+[A-Za-z0-9._-]+/gi, // bearer tokens
  /\b(?:mysql|postgres(?:ql)?|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi, // DSNs with credentials
];

/** Redact secret-shaped substrings inside a string value. */
export function redactSecretStrings(value: string): string {
  let out = value;
  for (const re of SECRET_VALUE_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

const MAX_DEPTH = 8;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Deep-redact a value: any property whose KEY is sensitive becomes `[REDACTED]`; any string value
 * has secret-shaped substrings redacted; everything else is preserved (so debug context like
 * function/table names survives). Prototype-polluting keys are dropped. Cycles / over-deep
 * structures truncate to `[REDACTED]`. Returns a NEW value; the input is never mutated.
 */
export function redactSensitive(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return REDACTED;
  if (typeof value === 'string') return redactSecretStrings(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redactSensitive(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) continue; // never reflect a prototype-polluting key
    out[key] = isSensitiveKey(key) ? REDACTED : redactSensitive(v, depth + 1);
  }
  return out;
}

/**
 * The Sentry event/breadcrumb scrubber (spec 15) — pure, shared by the API and web `beforeSend`.
 * It (1) deep-redacts denylisted keys + secret-pattern strings via {@link redactSensitive}, then
 * (2) DROPS the request body, query string, cookies, AND headers wholesale (they can carry secrets
 * under header names — e.g. `x-api-key`, `cookie` — or raw values under benign keys), plus the
 * server name/IP. Note: application code must never place raw client-DB rows into a Sentry event
 * `extra`/`contexts`; this scrubber redacts by key/pattern but cannot recognize a row value under
 * a benign key. (In this codebase no `captureException` is ever passed row data.)
 */
export interface ScrubbableEvent {
  request?: {
    data?: unknown;
    query_string?: unknown;
    cookies?: unknown;
    headers?: unknown;
    [key: string]: unknown;
  };
  server_name?: string;
  [key: string]: unknown;
}

export function scrubSentryEvent<T extends ScrubbableEvent>(event: T): T {
  const scrubbed = redactSensitive(event) as T;
  if (scrubbed.request) {
    delete scrubbed.request.data;
    delete scrubbed.request.query_string;
    delete scrubbed.request.cookies;
    delete scrubbed.request.headers; // headers dropped wholesale — never rely on key matching here
  }
  delete scrubbed.server_name;
  return scrubbed;
}

export function scrubSentryBreadcrumb<T>(breadcrumb: T): T {
  return redactSensitive(breadcrumb) as T;
}

/**
 * Write-site guard (spec 15): does this value still carry a sensitive LEAF — a denylisted key whose
 * value is not already neutralized (redacted / a type-tag placeholder)? Proves no DENYLISTED key
 * survived a write. (It cannot certify a secret hidden under a benign key — that is the scrubber's
 * wholesale-drop + pattern job.) Returns the first offending key path, or null if clean.
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
      const neutral =
        v === REDACTED || v === 'string' || v === 'number' || v === 'boolean' || v === null;
      if (!neutral) return here;
    }
    const deeper = findSensitiveLeaf(v, here, depth + 1);
    if (deeper) return deeper;
  }
  return null;
}
