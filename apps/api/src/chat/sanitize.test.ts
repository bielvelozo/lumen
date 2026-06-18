import { describe, it, expect } from 'vitest';
import { sanitizeParams, chatErrorFromCategory } from './sanitize';

describe('sanitizeParams — no raw values ever stored', () => {
  it('replaces every leaf value with a type tag, keeping keys + shape', () => {
    const sanitized = sanitizeParams({
      table: 'orders',
      metric: { agg: 'sum', column: 'total' },
      filters: [{ column: 'status', op: 'eq', value: 'paid' }],
      from: '2026-01-01',
    });
    expect(sanitized).toEqual({
      table: 'string',
      metric: { agg: 'string', column: 'string' },
      filters: [{ column: 'string', op: 'string', value: 'string' }],
      from: 'string',
    });
  });

  it('never carries a schema name, filter value, or secret', () => {
    const json = JSON.stringify(
      sanitizeParams({ table: 'salaries', filters: [{ value: 'sk-ant-secret' }], host: 'db.internal' }),
    );
    expect(json).not.toContain('salaries');
    expect(json).not.toContain('sk-ant-secret');
    expect(json).not.toContain('db.internal');
  });
});

describe('chatErrorFromCategory', () => {
  it('maps provider categories to sanitized chat codes', () => {
    expect(chatErrorFromCategory('invalid_key')).toBe('ai_key_invalid');
    expect(chatErrorFromCategory('model_unavailable')).toBe('ai_key_invalid');
    expect(chatErrorFromCategory('rate_limited')).toBe('ai_rate_limited');
    expect(chatErrorFromCategory('network')).toBe('ai_unavailable');
    expect(chatErrorFromCategory('unknown')).toBe('unknown');
  });
});
