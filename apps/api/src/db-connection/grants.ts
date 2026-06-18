/**
 * Parse `SHOW GRANTS FOR CURRENT_USER()` output to decide whether the credential is
 * over-privileged (spec 08, defense-in-depth on invariant 5). Read-only by intent means the
 * only privilege is `SELECT` (plus harmless `USAGE`). Anything that can write, do DDL, or
 * administer — or `WITH GRANT OPTION` / `ALL PRIVILEGES` — makes the credential
 * over-privileged, which spec 08 REJECTS (never stores).
 */

/** Privilege tokens that mark a write/DDL/admin (i.e. non-read-only) credential. */
const FORBIDDEN_PRIVILEGES = [
  'ALL PRIVILEGES',
  'INSERT',
  'UPDATE',
  'DELETE',
  'CREATE',
  'DROP',
  'ALTER',
  'INDEX',
  'REFERENCES',
  'TRIGGER',
  'EVENT',
  'EXECUTE',
  'LOCK TABLES',
  'CREATE VIEW',
  'CREATE ROUTINE',
  'ALTER ROUTINE',
  'CREATE USER',
  'CREATE TABLESPACE',
  'RELOAD',
  'SHUTDOWN',
  'PROCESS',
  'FILE',
  'SUPER',
  'REPLICATION SLAVE',
  'REPLICATION CLIENT',
];

export interface GrantsAnalysis {
  overPrivileged: boolean;
}

export function analyzeGrants(grants: readonly string[]): GrantsAnalysis {
  const overPrivileged = grants.some((grant) => {
    const upper = grant.toUpperCase();
    // `WITH GRANT OPTION` can appear after the object — check the whole statement.
    if (upper.includes('WITH GRANT OPTION')) return true;
    // The privilege list is everything before ` ON `; checking only that avoids a
    // false positive from a database/table named e.g. `insert_logs`.
    const privilegeList = upper.split(' ON ')[0] ?? upper;
    return FORBIDDEN_PRIVILEGES.some((priv) => privilegeList.includes(priv));
  });
  return { overPrivileged };
}
