import { describe, it, expect } from 'vitest';
import { cliNoticeCategory } from './chat-model-agent-sdk';

describe('cliNoticeCategory', () => {
  it('recognizes the quota notices that arrive as a successful result', () => {
    // Both observed live in subscription mode.
    expect(cliNoticeCategory('Usage credits are required for long context requests.')).toBe(
      'rate_limited',
    );
    expect(cliNoticeCategory('  Credit balance is too low.  ')).toBe('rate_limited');
    expect(cliNoticeCategory('Claude AI usage limit reached')).toBe('rate_limited');
  });

  it('recognizes the other CLI status lines', () => {
    // Observed live asking Haiku 4.5 a normal question.
    expect(cliNoticeCategory('Prompt is too long')).toBe('unknown');
    expect(cliNoticeCategory('API Error: 500')).toBe('unknown');
  });

  it('never swallows a real answer', () => {
    expect(
      cliNoticeCategory('Em maio de 2026 você teve 90 pedidos: 38 no site, 29 na loja e 23 no WhatsApp.'),
    ).toBeNull();
    expect(cliNoticeCategory('Não tenho acesso a esses dados.')).toBeNull();
    // Mentioning the words mid-answer is not a notice.
    expect(
      cliNoticeCategory('Seu plano tem 120 créditos: usage credits are required para o próximo ciclo.'),
    ).toBeNull();
  });

  it('does not treat a long text that merely starts with the words as a notice', () => {
    expect(cliNoticeCategory(`Prompt is too long ${'x'.repeat(400)}`)).toBeNull();
  });
});
