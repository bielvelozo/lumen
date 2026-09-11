import { describe, it, expect } from 'vitest';
import { isCliStatusNotice } from './chat-model-agent-sdk';

describe('isCliStatusNotice', () => {
  it('recognizes the CLI notices that arrive as a successful result', () => {
    // Observed live on a turn that answered correctly on retry.
    expect(isCliStatusNotice('Usage credits are required for long context requests.')).toBe(true);
    expect(isCliStatusNotice('  Credit balance is too low.  ')).toBe(true);
    expect(isCliStatusNotice('Claude usage limit reached. Try again later.')).toBe(true);
  });

  it('never swallows a real answer', () => {
    expect(isCliStatusNotice('Em maio de 2026 você teve 90 pedidos: 38 no site, 29 na loja e 23 no WhatsApp.')).toBe(
      false,
    );
    expect(isCliStatusNotice('Não tenho acesso a esses dados.')).toBe(false);
    // Mentioning the words mid-answer is not a notice.
    expect(
      isCliStatusNotice('Seu plano tem 120 créditos: usage credits are required para o próximo ciclo.'),
    ).toBe(false);
  });

  it('does not treat a long text that merely starts with the words as a notice', () => {
    const long = `Usage credits are required ${'x'.repeat(400)}`;
    expect(isCliStatusNotice(long)).toBe(false);
  });
});
