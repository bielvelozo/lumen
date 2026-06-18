import { describe, it, expect } from 'vitest';
import { buildOnboardingScript } from './onboarding-script';

/** SQL statement lines (comments stripped) — the deny-list applies to what is EXECUTED. */
function sqlOnly(script: string): string {
  return script
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return t.length > 0 && !t.startsWith('--') && !t.startsWith('#');
    })
    .join('\n');
}

describe('buildOnboardingScript', () => {
  it('emits the allow-list: CREATE USER + GRANT SELECT + FLUSH PRIVILEGES', () => {
    const { script, engine, username } = buildOnboardingScript();
    expect(engine).toBe('mysql');
    expect(username).toBe('lumen_ro');
    expect(script).toContain('CREATE USER');
    expect(script).toContain('GRANT SELECT');
    expect(script).toContain('FLUSH PRIVILEGES');
  });

  it('emits NONE of the forbidden privileges/DDL in the executed SQL', () => {
    const sql = sqlOnly(buildOnboardingScript({ databaseName: 'shop' }).script);
    expect(sql).not.toContain('ALL PRIVILEGES');
    expect(sql).not.toContain('GRANT OPTION');
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|DROP|SUPER)\b/i);
    expect(sql).not.toMatch(/CREATE\s+(TABLE|DATABASE)/i);
    expect(sql).not.toMatch(/GRANT\s+CREATE/i);
  });

  it('never defines a root user as the credential', () => {
    const { script } = buildOnboardingScript();
    expect(script).not.toMatch(/CREATE USER\s+['"`]?root/i);
    expect(script).not.toMatch(/['"`]root['"`]?@/);
  });

  it('scopes the grant to the given database', () => {
    const { script } = buildOnboardingScript({ databaseName: 'shop' });
    expect(script).toContain('GRANT SELECT ON `shop`.* TO');
    expect(script).not.toContain('*.*'); // never globally scoped
  });

  it('uses a clearly-commented placeholder (not a silent global grant) when no db given', () => {
    const { script } = buildOnboardingScript();
    expect(script).toContain('GRANT SELECT ON `<SEU_BANCO>`.* TO');
    expect(script).not.toContain('*.*');
  });

  it('respects a custom username and the active REQUIRE SSL option', () => {
    const { script, username } = buildOnboardingScript({ username: 'ro_user', requireSsl: true });
    expect(username).toBe('ro_user');
    expect(script).toContain("CREATE USER 'ro_user'@'%'");
    expect(script).toContain('REQUIRE SSL');
  });

  it('never embeds a real password — only a placeholder', () => {
    const { script } = buildOnboardingScript();
    expect(script).toContain('<DEFINA_UMA_SENHA_FORTE>');
  });
});
