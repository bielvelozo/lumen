import { describe, it, expect, vi } from 'vitest';
import type { ClaudeModelId } from '@lumen/shared';
import { createAiConnectionService } from './ai-connection.service';
import type { AiConnectionStore, StoredAiConnection } from './ai-connection.store';
import type { ClaudeValidator, ValidationResult } from './claude-validator';

const NOW = new Date('2026-06-18T12:00:00.000Z');
const SECRET_KEY = 'sk-ant-super-secret-do-not-leak';

function makeStore(initial: StoredAiConnection | null = null) {
  let row: StoredAiConnection | null = initial;
  const store: AiConnectionStore = {
    getByOrg: vi.fn(async () => row),
    getState: vi.fn(async () =>
      row
        ? { defaultModel: row.defaultModel, status: row.status, lastValidatedAt: NOW, lastError: null }
        : null,
    ),
    upsertActive: vi.fn(async (input) => {
      row = {
        id: 'aic-1',
        encryptedApiKey: input.encryptedApiKey,
        defaultModel: input.model,
        status: 'active',
      };
    }),
    markActive: vi.fn(async (_orgId, input) => {
      if (row) row = { ...row, defaultModel: input.model, status: 'active' };
    }),
    setFailed: vi.fn(async () => {
      if (row) row = { ...row, status: 'failed' };
    }),
  };
  return { store, peek: () => row };
}

function makeValidator(result: ValidationResult): ClaudeValidator {
  return { validate: vi.fn(async (): Promise<ValidationResult> => result) };
}

// Fake crypto: a recognizable wrapper so tests can assert what was encrypted/decrypted.
const encrypt = vi.fn((s: string) => Buffer.from(`enc:${s}`));
const decrypt = vi.fn((b: Buffer) => b.toString('utf8').replace(/^enc:/, ''));

function makeService(store: AiConnectionStore, validator: ClaudeValidator) {
  return createAiConnectionService({ store, validator, encrypt, decrypt, now: () => NOW });
}

const MODEL: ClaudeModelId = 'claude-opus-4-8';

describe('connect — happy path (paste new key, valid)', () => {
  it('encrypts and stores the key, goes active, and never returns the key', async () => {
    const { store, peek } = makeStore(null);
    const validator = makeValidator({ outcome: 'valid' });
    const service = makeService(store, validator);

    const res = await service.connect('org-1', { apiKey: SECRET_KEY, model: MODEL });

    expect(res.outcome).toBe('connected');
    expect(store.upsertActive).toHaveBeenCalledOnce();
    // The stored ciphertext is the encrypted key (never the plaintext).
    expect(peek()?.encryptedApiKey).toEqual(Buffer.from(`enc:${SECRET_KEY}`));
    expect(res.outcome === 'connected' && res.result.state).toMatchObject({
      provider: 'claude',
      hasKey: true,
      status: 'active',
      defaultModel: MODEL,
      lastError: null,
    });
    // No field of the response carries the key.
    expect(JSON.stringify(res)).not.toContain(SECRET_KEY);
  });
});

describe('connect — each failure category sanitized + no-store-on-failure', () => {
  for (const category of ['invalid_key', 'model_unavailable', 'rate_limited', 'network', 'unknown'] as const) {
    it(`maps ${category} to status-less response and stores NOTHING for a first-time key`, async () => {
      const { store, peek } = makeStore(null);
      const validator = makeValidator({ outcome: 'invalid', category });
      const service = makeService(store, validator);

      const res = await service.connect('org-1', { apiKey: SECRET_KEY, model: MODEL });

      expect(res.outcome).toBe('validation_failed');
      expect(res.outcome === 'validation_failed' && res.result.error).toBe(category);
      // Nothing persisted: no key proven dead is ever stored.
      expect(store.upsertActive).not.toHaveBeenCalled();
      expect(store.markActive).not.toHaveBeenCalled();
      expect(store.setFailed).not.toHaveBeenCalled();
      expect(peek()).toBeNull();
      expect(JSON.stringify(res)).not.toContain(SECRET_KEY);
    });
  }
});

describe('connect — existing active connection protected from a bad paste', () => {
  it('does not overwrite the stored key or downgrade on a failed re-key', async () => {
    const existing: StoredAiConnection = {
      id: 'aic-1',
      encryptedApiKey: Buffer.from('enc:old-good-key'),
      defaultModel: MODEL,
      status: 'active',
    };
    const { store, peek } = makeStore(existing);
    const validator = makeValidator({ outcome: 'invalid', category: 'invalid_key' });
    const service = makeService(store, validator);

    const res = await service.connect('org-1', { apiKey: 'sk-ant-typo', model: MODEL });

    expect(res.outcome).toBe('validation_failed');
    expect(store.upsertActive).not.toHaveBeenCalled();
    expect(store.setFailed).not.toHaveBeenCalled();
    expect(peek()).toEqual(existing); // untouched
  });
});

describe('connect — re-validate stored key (no apiKey)', () => {
  it('404s when there is no stored connection', async () => {
    const { store } = makeStore(null);
    const service = makeService(store, makeValidator({ outcome: 'valid' }));
    const res = await service.connect('org-1', { model: MODEL });
    expect(res.outcome).toBe('no_connection');
  });

  it('reuses the stored key (decrypt, no re-paste) and goes active on success', async () => {
    const existing: StoredAiConnection = {
      id: 'aic-1',
      encryptedApiKey: Buffer.from('enc:stored-key'),
      defaultModel: 'claude-haiku-4-5',
      status: 'active',
    };
    const { store } = makeStore(existing);
    const validator = makeValidator({ outcome: 'valid' });
    const service = makeService(store, validator);

    const res = await service.connect('org-1', { model: MODEL });

    expect(decrypt).toHaveBeenCalledWith(Buffer.from('enc:stored-key'));
    expect(validator.validate).toHaveBeenCalledWith('stored-key', MODEL);
    expect(store.markActive).toHaveBeenCalledOnce(); // ciphertext untouched
    expect(store.upsertActive).not.toHaveBeenCalled();
    expect(res.outcome).toBe('connected');
  });

  it('downgrades to failed on a PERMANENT failure', async () => {
    const existing: StoredAiConnection = {
      id: 'aic-1',
      encryptedApiKey: Buffer.from('enc:stored-key'),
      defaultModel: MODEL,
      status: 'active',
    };
    const { store } = makeStore(existing);
    const service = makeService(store, makeValidator({ outcome: 'invalid', category: 'invalid_key' }));
    await service.connect('org-1', { model: MODEL });
    expect(store.setFailed).toHaveBeenCalledWith('org-1', 'invalid_key');
  });

  it('does NOT downgrade on a TRANSIENT failure (rate_limited / network)', async () => {
    const existing: StoredAiConnection = {
      id: 'aic-1',
      encryptedApiKey: Buffer.from('enc:stored-key'),
      defaultModel: MODEL,
      status: 'active',
    };
    const { store } = makeStore(existing);
    const service = makeService(store, makeValidator({ outcome: 'invalid', category: 'network' }));
    const res = await service.connect('org-1', { model: MODEL });
    expect(store.setFailed).not.toHaveBeenCalled();
    expect(res.outcome === 'validation_failed' && res.result.error).toBe('network');
  });
});
