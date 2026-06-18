import { describe, it, expect } from 'vitest';
import { healthResponseSchema } from './dto';

describe('healthResponseSchema', () => {
  it('accepts the canonical health payload', () => {
    expect(healthResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
  });

  it('rejects a non-ok status', () => {
    expect(healthResponseSchema.safeParse({ status: 'down' }).success).toBe(false);
  });
});
