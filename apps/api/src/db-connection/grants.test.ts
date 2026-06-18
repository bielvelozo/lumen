import { describe, it, expect } from 'vitest';
import { analyzeGrants } from './grants';

describe('analyzeGrants', () => {
  it('treats a SELECT-only (read-only) user as NOT over-privileged', () => {
    expect(
      analyzeGrants([
        "GRANT USAGE ON *.* TO `lumen_ro`@`%`",
        "GRANT SELECT ON `shop`.* TO `lumen_ro`@`%`",
      ]).overPrivileged,
    ).toBe(false);
  });

  it('flags ALL PRIVILEGES + WITH GRANT OPTION (root) as over-privileged', () => {
    expect(
      analyzeGrants(["GRANT ALL PRIVILEGES ON *.* TO `root`@`localhost` WITH GRANT OPTION"])
        .overPrivileged,
    ).toBe(true);
  });

  it('flags a writer credential (INSERT/UPDATE/DELETE) as over-privileged', () => {
    expect(
      analyzeGrants(["GRANT SELECT, INSERT, UPDATE, DELETE ON `shop`.* TO `rw`@`%`"])
        .overPrivileged,
    ).toBe(true);
  });

  it('flags admin privileges (SUPER) as over-privileged', () => {
    expect(analyzeGrants(["GRANT SELECT, SUPER ON *.* TO `x`@`%`"]).overPrivileged).toBe(true);
  });

  it('does NOT false-positive on a database/table named like a privilege', () => {
    // 'insert_logs' is the object, not a granted privilege.
    expect(
      analyzeGrants(["GRANT SELECT ON `insert_logs`.* TO `lumen_ro`@`%`"]).overPrivileged,
    ).toBe(false);
  });

  it('flags MySQL 8 dynamic/admin privileges (denylist would miss these)', () => {
    // SELECT line looks read-only, but the dynamic-privilege line is administrative.
    expect(
      analyzeGrants([
        "GRANT SELECT ON *.* TO `x`@`%`",
        "GRANT BACKUP_ADMIN,SYSTEM_USER,CONNECTION_ADMIN ON *.* TO `x`@`%`",
      ]).overPrivileged,
    ).toBe(true);
    expect(analyzeGrants(["GRANT PROXY ON ''@'' TO `x`@`%`"]).overPrivileged).toBe(true);
  });

  it('accepts a column-scoped SELECT but still catches a column-scoped write', () => {
    expect(
      analyzeGrants(["GRANT SELECT (id, name) ON `shop`.`orders` TO `ro`@`%`"]).overPrivileged,
    ).toBe(false);
    expect(
      analyzeGrants(["GRANT SELECT (id), INSERT (note) ON `shop`.`orders` TO `rw`@`%`"])
        .overPrivileged,
    ).toBe(true);
  });

  it('a line that is not a GRANT ... ON ... is rejected (fail-safe)', () => {
    expect(analyzeGrants(['GRANT `app_role` TO `x`@`%`']).overPrivileged).toBe(true);
  });
});
