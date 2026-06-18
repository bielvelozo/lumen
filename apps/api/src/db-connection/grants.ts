/**
 * Parse `SHOW GRANTS FOR CURRENT_USER()` output to decide whether the credential is
 * over-privileged (spec 08, defense-in-depth on invariant 5). DENY-BY-ALLOWLIST: a grant is
 * over-privileged unless EVERY privilege token in its privilege list is read-only-safe
 * (`SELECT`, `USAGE`, `SHOW VIEW`). This structurally rejects every present and future
 * write/DDL/admin privilege — including MySQL 8 dynamic privileges (`SYSTEM_USER`,
 * `BACKUP_ADMIN`, `CONNECTION_ADMIN`, …), `ALL PRIVILEGES`, `PROXY`, and `GRANT OPTION` —
 * rather than chasing an open-ended denylist (Gate-1 security-review fix).
 */

/** The only privileges a read-only credential may hold. Anything else ⇒ over-privileged. */
const SAFE_PRIVILEGES = new Set(['SELECT', 'USAGE', 'SHOW VIEW']);

export interface GrantsAnalysis {
  overPrivileged: boolean;
}

export function analyzeGrants(grants: readonly string[]): GrantsAnalysis {
  const overPrivileged = grants.some((grant) => {
    const upper = grant.toUpperCase().trim();
    // `WITH GRANT OPTION` lets the user grant privileges to others — never read-only.
    if (upper.includes('WITH GRANT OPTION')) return true;

    // The privilege list is everything before the first ` ON `.
    const onIndex = upper.indexOf(' ON ');
    if (onIndex === -1) return true; // not a `GRANT ... ON ...` line → reject (fail-safe)

    let privilegeList = upper.slice(0, onIndex);
    if (privilegeList.startsWith('GRANT ')) privilegeList = privilegeList.slice('GRANT '.length);
    // Drop any column-level lists like `SELECT (col1, col2)` so column-scoped SELECT stays safe
    // while column-scoped writes (e.g. `INSERT (col)`) are still caught by their keyword.
    privilegeList = privilegeList.replace(/\([^)]*\)/g, '');

    const tokens = privilegeList
      .split(',')
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

    // Over-privileged if ANY granted privilege is not in the read-only safe set.
    return tokens.some((token) => !SAFE_PRIVILEGES.has(token));
  });
  return { overPrivileged };
}
