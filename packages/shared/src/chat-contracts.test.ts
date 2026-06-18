import { describe, it, expect } from 'vitest';
import { sendMessageRequestSchema, CHAT_ERROR_CODES } from './chat-contracts';

describe('sendMessageRequestSchema', () => {
  it('accepts a non-empty message', () => {
    expect(sendMessageRequestSchema.safeParse({ message: 'quanto vendi em maio?' }).success).toBe(true);
  });

  it('rejects an empty / whitespace message', () => {
    expect(sendMessageRequestSchema.safeParse({ message: '   ' }).success).toBe(false);
    expect(sendMessageRequestSchema.safeParse({ message: '' }).success).toBe(false);
  });

  it('rejects a smuggled org_id / sessionId (strict — anti-IDOR)', () => {
    expect(sendMessageRequestSchema.safeParse({ message: 'hi', orgId: 'x' }).success).toBe(false);
    expect(sendMessageRequestSchema.safeParse({ message: 'hi', sessionId: 'y' }).success).toBe(false);
  });
});

describe('CHAT_ERROR_CODES', () => {
  it('is the closed sanitized set', () => {
    expect(CHAT_ERROR_CODES).toContain('ai_not_connected');
    expect(CHAT_ERROR_CODES).toContain('model_refused');
    expect(CHAT_ERROR_CODES).toContain('data_source_unavailable');
    expect(CHAT_ERROR_CODES).toContain('step_limit');
  });
});
