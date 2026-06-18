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
});
