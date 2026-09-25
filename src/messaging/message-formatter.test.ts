import { coalesceTextContent, formatForChannel } from './message-formatter';
import { MessageContent } from './interfaces';
import { LLMProvider } from '../ai-agent/interfaces';

// ── coalesceTextContent (deterministic, LLM-independent) ─────────────────────

describe('coalesceTextContent', () => {
  it('merges consecutive text items into a single item joined by a blank line', () => {
    const input: MessageContent[] = [
      { type: 'text', text: 'Is it clear and watery, or sticky and yellow?' },
      { type: 'text', text: 'And has it been present for more than 24 hours?' },
    ];

    const out = coalesceTextContent(input);

    expect(out).toEqual([
      {
        type: 'text',
        text: 'Is it clear and watery, or sticky and yellow?\n\nAnd has it been present for more than 24 hours?',
      },
    ]);
  });

  it('leaves a single text item untouched', () => {
    const input: MessageContent[] = [{ type: 'text', text: 'Hello there.' }];
    expect(coalesceTextContent(input)).toEqual(input);
  });

  it('does NOT coalesce across an interactive item (CONSENT_CHECK button flow)', () => {
    const input: MessageContent[] = [
      { type: 'text', text: 'Before we start I need your consent.' },
      {
        type: 'interactive',
        interactive: {
          type: 'button',
          body: 'Do you consent?',
          buttons: [
            { id: 'yes', title: 'Yes, I consent' },
            { id: 'no', title: "No, I don't" },
          ],
        },
      },
      { type: 'text', text: 'Thanks.' },
    ];

    const out = coalesceTextContent(input);

    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ type: 'text', text: 'Before we start I need your consent.' });
    expect(out[1].type).toBe('interactive');
    expect(out[2]).toEqual({ type: 'text', text: 'Thanks.' });
  });

  it('passes a lone interactive item through unchanged', () => {
    const input: MessageContent[] = [
      {
        type: 'interactive',
        interactive: { type: 'button', body: 'Pick one', buttons: [{ id: 'a', title: 'A' }] },
      },
    ];
    expect(coalesceTextContent(input)).toEqual(input);
  });

  it('merges runs on both sides of an interactive item independently', () => {
    const input: MessageContent[] = [
      { type: 'text', text: 'one' },
      { type: 'text', text: 'two' },
      { type: 'interactive', interactive: { type: 'button', body: 'b', buttons: [{ id: 'x', title: 'X' }] } },
      { type: 'text', text: 'three' },
      { type: 'text', text: 'four' },
    ];

    const out = coalesceTextContent(input);

    expect(out.map(c => c.type)).toEqual(['text', 'interactive', 'text']);
    expect(out[0].text).toBe('one\n\ntwo');
    expect(out[2].text).toBe('three\n\nfour');
  });

  it('splits a merged block longer than the hard cap into chunks within the cap', () => {
    const para = 'x'.repeat(3000);
    const input: MessageContent[] = [
      { type: 'text', text: para },
      { type: 'text', text: para },
    ];

    const out = coalesceTextContent(input, 4096);

    expect(out.length).toBeGreaterThan(1);
    for (const c of out) {
      expect(c.type).toBe('text');
      expect((c.text ?? '').length).toBeLessThanOrEqual(4096);
    }
    // No content is lost (ignoring the join/split whitespace).
    expect(out.map(c => c.text).join('').replace(/\s/g, '')).toBe((para + para).replace(/\s/g, ''));
  });

  it('drops empty text items rather than emitting blank bubbles', () => {
    const input: MessageContent[] = [
      { type: 'text', text: 'real' },
      { type: 'text', text: '' },
    ];
    expect(coalesceTextContent(input)).toEqual([{ type: 'text', text: 'real' }]);
  });
});

// ── formatForChannel integration ────────────────────────────────────────────

function mockLLM(content: string): LLMProvider {
  return {
    complete: jest.fn().mockResolvedValue({
      content,
      finishReason: 'stop',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    }),
    stream: jest.fn(),
  } as unknown as LLMProvider;
}

describe('formatForChannel', () => {
  it('consolidates a formatter LLM that still splits into multiple text bubbles', async () => {
    const llm = mockLLM(JSON.stringify([
      { type: 'text', text: 'Sentence one.' },
      { type: 'text', text: 'Sentence two.' },
      { type: 'text', text: 'Sentence three.' },
    ]));

    const out = await formatForChannel(llm, 'clinical', 'CONVERSATION' as any, 'whatsapp', 'en');

    expect(out).toEqual([{ type: 'text', text: 'Sentence one.\n\nSentence two.\n\nSentence three.' }]);
  });

  it('keeps a CONSENT_CHECK interactive item separate', async () => {
    const llm = mockLLM(JSON.stringify([
      {
        type: 'interactive',
        interactive: {
          type: 'button',
          body: 'Do you consent?',
          buttons: [
            { id: 'yes', title: 'Yes, I consent' },
            { id: 'no', title: "No, I don't" },
          ],
        },
      },
    ]));

    const out = await formatForChannel(llm, 'clinical', 'CONSENT_CHECK' as any, 'whatsapp', 'en');

    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('interactive');
  });
});
