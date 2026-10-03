import { describe, it, expect } from 'vitest';
import { formatDateTime } from './format';

describe('formatDateTime', () => {
  it('renders an ISO timestamp as a pt-BR local date and time', () => {
    const iso = '2026-06-18T12:00:00.000Z';
    const local = new Date(iso);
    const expected = `${String(local.getDate()).padStart(2, '0')}/${String(local.getMonth() + 1).padStart(2, '0')}/${local.getFullYear()}`;
    expect(formatDateTime(iso)).toContain(expected);
    expect(formatDateTime(iso)).not.toContain('T12:00');
  });

  it('keeps an unparseable value as is instead of printing "Invalid Date"', () => {
    expect(formatDateTime('ontem')).toBe('ontem');
  });
});
