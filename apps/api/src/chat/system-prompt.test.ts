import { describe, expect, it } from 'vitest';
import type { ExposedAllowList } from '../query-registry/allow-list';
import { buildSystemPrompt } from './system-prompt';

const allowList: ExposedAllowList = {
  tables: new Map([['pedidos', new Map([['total', 'decimal(10,2)'], ['criado_em', 'datetime']])]]),
  relationships: [],
};

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt(allowList);

  it('keeps the precision invariant: numbers only from function results', () => {
    expect(prompt).toContain('NUNCA invente, estime ou calcule um número');
  });

  it('forbids presenting a summed unit-price column as revenue', () => {
    expect(prompt).toContain('Somar uma coluna de preço unitário NÃO é faturamento');
  });

  it('makes data-grounded marketing and sales ideas part of the job, not out of scope', () => {
    expect(prompt).toMatch(/consultor/i);
    expect(prompt).toMatch(/marketing/i);
    expect(prompt).toMatch(/promo/i);
    expect(prompt).toContain('NUNCA recuse um pedido de ideia, estratégia ou sugestão de negócio');
  });

  it('tells the model to fetch the data itself before suggesting, instead of offering to', () => {
    expect(prompt).toContain('consulte os dados ANTES de sugerir');
    expect(prompt).toMatch(/não pergunte se deve rodar/i);
  });

  it('separates measured numbers from proposals in the answer', () => {
    expect(prompt).toMatch(/sugest/i);
    expect(prompt).toMatch(/não é um dado/i);
  });
});
