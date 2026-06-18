import { describe, it, expect } from 'vitest';
import { APICallError } from 'ai';
import { categorizeProviderError, createAiSdkValidator } from './claude-validator';

function apiError(statusCode: number | undefined): APICallError {
  return new APICallError({
    message: 'raw provider text that must never leak',
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    statusCode,
  });
}

describe('categorizeProviderError — sanitized closed-set mapping', () => {
  it('maps 401 / 403 to invalid_key', () => {
    expect(categorizeProviderError(apiError(401))).toBe('invalid_key');
    expect(categorizeProviderError(apiError(403))).toBe('invalid_key');
  });

  it('maps 404 to model_unavailable', () => {
    expect(categorizeProviderError(apiError(404))).toBe('model_unavailable');
  });

  it('maps 429 to rate_limited', () => {
    expect(categorizeProviderError(apiError(429))).toBe('rate_limited');
  });

  it('maps 5xx / 529 / no-status to network', () => {
    expect(categorizeProviderError(apiError(500))).toBe('network');
    expect(categorizeProviderError(apiError(529))).toBe('network');
    expect(categorizeProviderError(apiError(undefined))).toBe('network');
  });

  it('maps an abort/timeout to network', () => {
    expect(categorizeProviderError(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toBe(
      'network',
    );
    expect(categorizeProviderError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(
      'network',
    );
  });

  it('maps anything else to unknown (raw text discarded)', () => {
    expect(categorizeProviderError(apiError(400))).toBe('unknown');
    expect(categorizeProviderError(new Error('weird'))).toBe('unknown');
    expect(categorizeProviderError(null)).toBe('unknown');
  });
});

// LIVE smoke — only runs when a real key is present (env-gated; ledgered as
// LIVE-VERIFICATION-PENDING). A bad-but-shaped key must categorize, not throw.
describe.skipIf(!process.env.ANTHROPIC_API_KEY)('createAiSdkValidator (live)', () => {
  it('validates the real key against the default model', async () => {
    const validator = createAiSdkValidator({ timeoutMs: 15_000 });
    const result = await validator.validate(process.env.ANTHROPIC_API_KEY as string, 'claude-opus-4-8');
    expect(result.outcome).toBe('valid');
  });

  it('returns invalid_key for a bogus key (never throws raw text)', async () => {
    const validator = createAiSdkValidator({ timeoutMs: 15_000 });
    const result = await validator.validate('sk-ant-not-a-real-key', 'claude-opus-4-8');
    expect(result).toEqual({ outcome: 'invalid', category: 'invalid_key' });
  });
});
