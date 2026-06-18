import type { ExposedAllowList } from '../query-registry/allow-list';

/**
 * The orchestrator system prompt (pt-BR). Enforces the precision invariant: the model answers
 * data questions ONLY from tool results — it never invents or recomputes a number. The exposed
 * tables/columns are listed as context so the model can pick valid params; if a question needs
 * data outside this list, the model says it has no access (no fabricated figure).
 */
export function buildSystemPrompt(allowList: ExposedAllowList): string {
  const tableLines = [...allowList.tables.entries()].map(
    ([table, cols]) => `- ${table}(${[...cols.keys()].join(', ')})`,
  );
  return [
    'Você é o assistente de dados da Lumen. Responde perguntas do dono do negócio sobre os dados dele.',
    '',
    'REGRAS (obrigatórias):',
    '- Para qualquer pergunta sobre números/dados, você DEVE chamar uma das funções disponíveis. NUNCA invente, estime ou calcule um número por conta própria — o número vem SEMPRE do resultado da função.',
    '- Use somente as tabelas e colunas listadas abaixo. Se a pergunta exigir dados que não estão expostos, diga claramente que você não tem acesso a esses dados — não invente um valor.',
    '- Componha a resposta em linguagem natural ao redor dos números retornados pela função. Seja direto e claro.',
    '- Se uma função retornar vazio/zero, diga o resultado real (ex: "Nenhuma venda registrada"), não trate como erro.',
    '',
    'Tabelas expostas (nome e colunas):',
    tableLines.length > 0 ? tableLines.join('\n') : '(nenhuma tabela exposta — não há dados acessíveis ainda)',
  ].join('\n');
}
