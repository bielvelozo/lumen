import { describe, it, expect } from 'vitest';
import { saveExposureRequestSchema } from './introspection-contracts';

describe('saveExposureRequestSchema', () => {
  it('accepts chosen table + relationship names', () => {
    const r = saveExposureRequestSchema.safeParse({
      tableNames: ['orders', 'products'],
      relationshipNames: ['orders__product_id__products'],
    });
    expect(r.success).toBe(true);
  });

  it('accepts empty selections (un-expose everything)', () => {
    expect(saveExposureRequestSchema.safeParse({ tableNames: [], relationshipNames: [] }).success).toBe(true);
  });

  it('rejects unknown fields (.strict) — e.g. a client-supplied connection id', () => {
    expect(
      saveExposureRequestSchema.safeParse({
        tableNames: ['orders'],
        relationshipNames: [],
        dbConnectionId: 'x',
      }).success,
    ).toBe(false);
    expect(
      saveExposureRequestSchema.safeParse({ tableNames: ['o'], relationshipNames: [], orgId: 'x' }).success,
    ).toBe(false);
  });
});
