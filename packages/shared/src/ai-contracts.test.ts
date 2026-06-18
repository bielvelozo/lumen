import { describe, it, expect } from 'vitest';
import {
  CLAUDE_MODELS,
  DEFAULT_MODEL,
  connectAiRequestSchema,
  aiConnectStateSchema,
} from './ai-contracts';

describe('curated Claude model list', () => {
  it('defaults to claude-opus-4-8', () => {
    expect(DEFAULT_MODEL).toBe('claude-opus-4-8');
    expect(CLAUDE_MODELS.some((m) => m.id === DEFAULT_MODEL)).toBe(true);
  });

  it('uses exact alias ids with NO date suffix', () => {
    for (const { id } of CLAUDE_MODELS) {
      // a date suffix would look like `-20251114`
      expect(id).not.toMatch(/-\d{8}$/);
      expect(id).toMatch(/^claude-[a-z]+-\d+-\d+$/);
    }
  });
});

describe('connectAiRequestSchema', () => {
  it('accepts a curated model with or without an apiKey', () => {
    expect(connectAiRequestSchema.safeParse({ model: 'claude-opus-4-8' }).success).toBe(true);
    expect(
      connectAiRequestSchema.safeParse({ apiKey: 'sk-ant-xxx', model: 'claude-haiku-4-5' }).success,
    ).toBe(true);
  });

  it('rejects a model outside the curated list (before any provider call)', () => {
    expect(connectAiRequestSchema.safeParse({ model: 'claude-opus-4-7' }).success).toBe(false);
    expect(connectAiRequestSchema.safeParse({ model: 'gpt-4' }).success).toBe(false);
  });

  it('rejects unknown fields (no org_id / connection id)', () => {
    expect(
      connectAiRequestSchema.safeParse({ model: 'claude-opus-4-8', orgId: 'x' }).success,
    ).toBe(false);
  });
});

describe('aiConnectStateSchema', () => {
  it('never carries the key — only non-secret state', () => {
    const state = {
      provider: 'claude' as const,
      hasKey: true,
      defaultModel: 'claude-opus-4-8' as const,
      status: 'active' as const,
      lastValidatedAt: '2026-06-18T12:00:00.000Z',
      lastError: null,
    };
    expect(aiConnectStateSchema.parse(state)).toEqual(state);
    expect(Object.keys(state)).not.toContain('apiKey');
    expect(Object.keys(state)).not.toContain('encryptedApiKey');
  });
});
