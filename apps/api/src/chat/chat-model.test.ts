import { describe, it, expect, vi, beforeEach } from 'vitest';

const streamTextMock = vi.hoisted(() => vi.fn());
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  streamText: streamTextMock,
}));

import { createAiSdkChatModel, textBlockSeparator, type ChatRunInput } from './chat-model';

const INPUT: ChatRunInput = {
  apiKey: 'sk-test',
  model: 'claude-sonnet-4-6',
  system: 'sistema',
  messages: [{ role: 'user', content: 'Quanto vendi em maio?' }],
  tools: [],
  maxSteps: 5,
};

function fakeStream(parts: unknown[], finishReason = 'stop'): unknown {
  return {
    fullStream: (async function* () {
      for (const part of parts) yield part;
    })(),
    finishReason: Promise.resolve(finishReason),
  };
}

describe('textBlockSeparator', () => {
  it('opens a paragraph between the text before and after a tool call', () => {
    expect(textBlockSeparator('Vou buscar as duas informações! 🔍')).toBe('\n\n');
    expect(textBlockSeparator('Vou buscar.\n')).toBe('\n');
  });

  it('adds nothing before the first block or after an existing paragraph break', () => {
    expect(textBlockSeparator('')).toBe('');
    expect(textBlockSeparator('  ')).toBe('');
    expect(textBlockSeparator('Vou buscar.\n\n')).toBe('');
  });
});

describe('createAiSdkChatModel', () => {
  beforeEach(() => streamTextMock.mockReset());

  it('separates the text written before and after a tool call, in the stream and the result', async () => {
    streamTextMock.mockReturnValue(
      fakeStream([
        { type: 'text-start', id: '1' },
        { type: 'text-delta', id: '1', text: 'Vou buscar! 🔍' },
        { type: 'text-end', id: '1' },
        { type: 'tool-call', toolCallId: 't1', toolName: 'filtered_aggregate', input: {} },
        { type: 'text-start', id: '2' },
        { type: 'text-delta', id: '2', text: 'Em maio: R$ 117.340,80.' },
        { type: 'text-end', id: '2' },
      ]),
    );
    const deltas: string[] = [];

    const result = await createAiSdkChatModel().run(INPUT, { onTextDelta: (d) => deltas.push(d) });

    expect(result).toEqual({ outcome: 'answered', text: 'Vou buscar! 🔍\n\nEm maio: R$ 117.340,80.' });
    expect(deltas.join('')).toBe('Vou buscar! 🔍\n\nEm maio: R$ 117.340,80.');
  });

  it('reports a provider error that arrives as a stream part instead of answering', async () => {
    streamTextMock.mockReturnValue(fakeStream([{ type: 'error', error: new Error('fetch failed') }]));

    const result = await createAiSdkChatModel().run(INPUT, { onTextDelta: () => {} });

    expect(result.outcome).toBe('error');
  });
});
