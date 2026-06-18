import { describe, it, expect } from 'vitest';
import { findSensitiveLeaf, REDACTED } from '@lumen/shared';
import { makeDrizzleFunctionLogStore, type FunctionLogInput } from './function-log.store';
import type { Database } from '../db/client';

function captureInsertStore() {
  const captured: { values?: unknown } = {};
  const db = {
    insert: () => ({
      values: (v: unknown) => {
        captured.values = v;
        return Promise.resolve();
      },
    }),
  } as unknown as Database;
  return { store: makeDrizzleFunctionLogStore(db), captured };
}

const BASE: Omit<FunctionLogInput, 'params'> = {
  orgId: 'org-1',
  userId: 'user-1',
  sessionId: 'sess-1',
  messageId: null,
  functionName: 'aggregate_over_time',
  status: 'success',
  durationMs: 10,
  provider: 'claude',
  model: 'claude-opus-4-8',
  errorMessage: null,
};

describe('function-log write-site guard (spec 15)', () => {
  it('redacts any denylisted key that reaches params — no secret survives the write', async () => {
    const { store, captured } = captureInsertStore();
    // A hostile/raw params object that should NEVER be persisted with real secret values.
    await store.insert({ ...BASE, params: { table: 'string', password: 'hunter2', apiKey: 'sk-ant-x' } });
    const written = (captured.values as { params: Record<string, unknown> }).params;
    expect(written.password).toBe(REDACTED);
    expect(written.apiKey).toBe(REDACTED);
    expect(written.table).toBe('string'); // benign shape kept
    expect(findSensitiveLeaf(written)).toBeNull(); // provably clean
    expect(JSON.stringify(written)).not.toContain('hunter2');
    expect(JSON.stringify(written)).not.toContain('sk-ant-x');
  });

  it('passes already type-tagged params through unchanged', async () => {
    const { store, captured } = captureInsertStore();
    await store.insert({ ...BASE, params: { table: 'string', metric: { agg: 'string', column: 'string' } } });
    const written = (captured.values as { params: Record<string, unknown> }).params;
    expect(written).toEqual({ table: 'string', metric: { agg: 'string', column: 'string' } });
  });

  it('leaves null params as null', async () => {
    const { store, captured } = captureInsertStore();
    await store.insert({ ...BASE, params: null });
    expect((captured.values as { params: unknown }).params).toBeNull();
  });
});
