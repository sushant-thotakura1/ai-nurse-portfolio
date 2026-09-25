import { mergeQuestionWamid, resolveQuotedQuestion } from './question-wamids';

describe('mergeQuestionWamid', () => {
  it('adds a new wamid -> question entry to an empty map', () => {
    const out = mergeQuestionWamid({}, 'wamid.A', 'Is your vision blurry?');
    expect(out).toEqual({ 'wamid.A': 'Is your vision blurry?' });
  });

  it('preserves existing entries when adding a new one', () => {
    const out = mergeQuestionWamid(
      { 'wamid.A': 'first question' },
      'wamid.B',
      'second question',
    );
    expect(out).toEqual({
      'wamid.A': 'first question',
      'wamid.B': 'second question',
    });
  });

  it('treats a null/undefined existing map as empty', () => {
    expect(mergeQuestionWamid(null, 'wamid.A', 'q')).toEqual({ 'wamid.A': 'q' });
    expect(mergeQuestionWamid(undefined, 'wamid.A', 'q')).toEqual({ 'wamid.A': 'q' });
  });

  it('caps the map at the most recent 20 entries, evicting the oldest', () => {
    let map: Record<string, string> = {};
    for (let i = 0; i < 25; i++) {
      map = mergeQuestionWamid(map, `wamid.${i}`, `question ${i}`);
    }
    const keys = Object.keys(map);
    expect(keys).toHaveLength(20);
    expect(keys[0]).toBe('wamid.5');
    expect(keys[19]).toBe('wamid.24');
    expect(map['wamid.0']).toBeUndefined();
  });
});

describe('resolveQuotedQuestion', () => {
  const map = { 'wamid.A': 'Is your vision blurry?' };

  it('returns the question text for a known wamid', () => {
    expect(resolveQuotedQuestion(map, 'wamid.A')).toBe('Is your vision blurry?');
  });

  it('returns undefined for an unknown / expired wamid', () => {
    expect(resolveQuotedQuestion(map, 'wamid.GONE')).toBeUndefined();
  });

  it('returns undefined when no contextMessageId is provided', () => {
    expect(resolveQuotedQuestion(map, undefined)).toBeUndefined();
  });

  it('returns undefined when the map is null / not an object', () => {
    expect(resolveQuotedQuestion(null, 'wamid.A')).toBeUndefined();
    expect(resolveQuotedQuestion('nonsense', 'wamid.A')).toBeUndefined();
  });
});
