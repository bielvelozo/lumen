/**
 * Identifier safety (spec 12, invariant 3). Identifiers reach SQL ONLY from the validated
 * allow-list — never from raw model text. This is the last line of defense: even an
 * allow-listed name is asserted to a safe charset and backtick-escaped, so an identifier can
 * never break out of its position. A name that fails the assertion (it shouldn't, post-guard)
 * throws and the executor maps it to a sanitized `query_failed`.
 */
const SAFE_IDENT = /^[A-Za-z0-9_]+$/;

export class UnsafeIdentifierError extends Error {
  constructor() {
    super('unsafe identifier'); // sanitized — never includes the offending value
    this.name = 'UnsafeIdentifierError';
  }
}

/** Quote a MySQL identifier. Asserts the safe charset, then backtick-escapes (belt + suspenders). */
export function quoteIdent(name: string): string {
  if (!SAFE_IDENT.test(name)) throw new UnsafeIdentifierError();
  return `\`${name.replace(/`/g, '``')}\``;
}
