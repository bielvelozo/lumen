import type { OnboardingScriptResponse } from '@lumen/shared';

/**
 * Generate the customer-facing MySQL onboarding script (spec 07). The customer runs it on
 * THEIR server to mint a dedicated, least-privilege user. It is read-only BY CONSTRUCTION:
 * we only ever emit `CREATE USER` + `GRANT SELECT` + `FLUSH PRIVILEGES`. We never generate,
 * request, transmit, or store the password — the script tells the owner to set their own.
 * Inputs are pre-validated safe identifiers (`^[A-Za-z0-9_]+$`); never `root`.
 */
export interface BuildOnboardingScriptOptions {
  username?: string;
  databaseName?: string;
  /** When true, emit an active `REQUIRE SSL`; otherwise a commented recommendation. */
  requireSsl?: boolean;
}

const DEFAULT_USERNAME = 'lumen_ro';
const PASSWORD_PLACEHOLDER = '<DEFINA_UMA_SENHA_FORTE>';
const DB_PLACEHOLDER = '<SEU_BANCO>';

export function buildOnboardingScript(
  options: BuildOnboardingScriptOptions = {},
): OnboardingScriptResponse {
  const username = options.username ?? DEFAULT_USERNAME;
  const dbName = options.databaseName ?? DB_PLACEHOLDER;
  const requireSslActive = options.requireSsl === true;

  const createUser = requireSslActive
    ? `CREATE USER '${username}'@'%' IDENTIFIED BY '${PASSWORD_PLACEHOLDER}' REQUIRE SSL;`
    : `CREATE USER '${username}'@'%' IDENTIFIED BY '${PASSWORD_PLACEHOLDER}';`;

  const lines: string[] = [
    '-- Lumen — usuario MySQL dedicado, somente leitura.',
    '-- Execute este script no SEU servidor MySQL, com um administrador do SEU banco.',
    '-- Ele cria um usuario com permissao de leitura apenas. Nao amplie as permissoes',
    '-- abaixo e nao use o usuario root como credencial do Lumen.',
    '--',
    `-- 1) Troque ${PASSWORD_PLACEHOLDER} por uma senha forte. O Lumen NUNCA recebe, gera`,
    '--    ou guarda essa senha — voce a informa depois, e ela e criptografada em repouso.',
    "-- 2) '@%' aceita conexao de qualquer host. Para restringir, troque '%' pelo IP/CIDR",
    '--    de saida da aplicacao.',
    '',
    createUser,
  ];

  if (!requireSslActive) {
    lines.push(
      '',
      '-- Recomendado: para exigir conexao segura, acrescente  REQUIRE SSL  ao final do',
      '-- CREATE USER acima.',
    );
  }

  lines.push(
    '',
    options.databaseName
      ? `-- Leitura liberada apenas no banco '${dbName}'.`
      : `-- Troque ${DB_PLACEHOLDER} pelo nome do banco a expor (a leitura fica restrita a ele).`,
    `GRANT SELECT ON \`${dbName}\`.* TO '${username}'@'%';`,
    '',
    'FLUSH PRIVILEGES;',
  );

  return { engine: 'mysql', username, script: lines.join('\n') };
}
