import { validateRedFlagResponse, redFlagCheck, RedFlagCheckInput } from '../red-flag-check';
import { LLMProvider, LLMProviderError } from '../../interfaces';
import { RedFlag } from '../../../knowledge-graph/types';
import { Turn } from '../../../orchestrator/session';

describe('validateRedFlagResponse', () => {
  it('accepts a well-formed verdict list', () => {
    const raw = [
      { red_flag_id: 'flag-1', fired: true, evidence: 'patient reports chest pain' },
      { red_flag_id: 'flag-2', fired: false, evidence: 'no shortness of breath noted' },
    ];

    const result = validateRedFlagResponse(raw, ['flag-1', 'flag-2']);

    expect(result.verdicts).toEqual([
      { red_flag_id: 'flag-1', fired: true },
      { red_flag_id: 'flag-2', fired: false },
    ]);
    expect(result.evidence.get('flag-1')).toBe('patient reports chest pain');
    expect(result.evidence.get('flag-2')).toBe('no shortness of breath noted');
    expect(result.unevaluated).toEqual([]);
  });

  it('discards a red_flag_id we did not ask about (hallucination guard)', () => {
    const raw = [
      { red_flag_id: 'flag-1', fired: true, evidence: 'patient reports chest pain' },
      { red_flag_id: 'flag-hallucinated', fired: false, evidence: 'invented evidence' },
    ];

    const result = validateRedFlagResponse(raw, ['flag-1']);

    expect(result.verdicts).toEqual([{ red_flag_id: 'flag-1', fired: true }]);
    expect(result.evidence.has('flag-hallucinated')).toBe(false);
    expect(result.unevaluated).not.toContain('flag-hallucinated');
    expect(result.unevaluated).toEqual([]);
  });

  it('marks a flag unevaluated when evidence is empty', () => {
    const raw = [{ red_flag_id: 'flag-1', fired: true, evidence: '   ' }];

    const result = validateRedFlagResponse(raw, ['flag-1']);

    expect(result.verdicts).toEqual([]);
    expect(result.evidence.has('flag-1')).toBe(false);
    expect(result.unevaluated).toEqual(['flag-1']);
  });

  it('marks a flag unevaluated when fired is not boolean (no coercion of truthy strings)', () => {
    const raw = [{ red_flag_id: 'flag-1', fired: 'true', evidence: 'some evidence text' }];

    const result = validateRedFlagResponse(raw, ['flag-1']);

    expect(result.verdicts).toEqual([]);
    expect(result.evidence.has('flag-1')).toBe(false);
    expect(result.unevaluated).toEqual(['flag-1']);
  });

  it('reports flags absent from the response as unevaluated', () => {
    const raw = [{ red_flag_id: 'flag-1', fired: true, evidence: 'evidence text' }];

    const result = validateRedFlagResponse(raw, ['flag-1', 'flag-2', 'flag-3']);

    expect(result.verdicts).toEqual([{ red_flag_id: 'flag-1', fired: true }]);
    expect(result.unevaluated).toEqual(['flag-2', 'flag-3']);
  });

  it('treats a completely non-array raw response as zero verdicts, all askedFor unevaluated, without throwing', () => {
    const askedFor = ['flag-1', 'flag-2'];

    expect(() => validateRedFlagResponse(null, askedFor)).not.toThrow();
    expect(() => validateRedFlagResponse(undefined, askedFor)).not.toThrow();
    expect(() => validateRedFlagResponse('not an array', askedFor)).not.toThrow();
    expect(() => validateRedFlagResponse({ red_flag_id: 'flag-1' }, askedFor)).not.toThrow();

    const result = validateRedFlagResponse({ not: 'an array' }, askedFor);

    expect(result).toEqual({
      verdicts: [],
      evidence: new Map(),
      unevaluated: ['flag-1', 'flag-2'],
    });
  });

  it('processes only the first occurrence of a duplicate red_flag_id and ignores subsequent ones', () => {
    const raw = [
      { red_flag_id: 'flag-1', fired: true, evidence: 'first evidence' },
      { red_flag_id: 'flag-1', fired: false, evidence: 'second evidence, should be ignored' },
    ];

    const result = validateRedFlagResponse(raw, ['flag-1']);

    expect(result.verdicts).toEqual([{ red_flag_id: 'flag-1', fired: true }]);
    expect(result.evidence.get('flag-1')).toBe('first evidence');
    expect(result.unevaluated).toEqual([]);
  });

  it('captures evidence for a valid fired:false verdict, not just fired:true', () => {
    const raw = [{ red_flag_id: 'flag-1', fired: false, evidence: 'ruled out based on history' }];

    const result = validateRedFlagResponse(raw, ['flag-1']);

    expect(result.verdicts).toEqual([{ red_flag_id: 'flag-1', fired: false }]);
    expect(result.evidence.get('flag-1')).toBe('ruled out based on history');
  });

  it('marks a flag unevaluated when evidence is missing or non-string', () => {
    const raw = [
      { red_flag_id: 'flag-1', fired: true },
      { red_flag_id: 'flag-2', fired: true, evidence: null },
      { red_flag_id: 'flag-3', fired: true, evidence: 42 },
    ];

    const result = validateRedFlagResponse(raw, ['flag-1', 'flag-2', 'flag-3']);

    expect(result.verdicts).toEqual([]);
    expect(result.unevaluated.sort()).toEqual(['flag-1', 'flag-2', 'flag-3']);
  });

  it('does not double-add a schema-invalid flag to unevaluated', () => {
    const raw = [{ red_flag_id: 'flag-1', fired: 'nope', evidence: 'valid evidence text' }];

    const result = validateRedFlagResponse(raw, ['flag-1']);

    expect(result.unevaluated).toEqual(['flag-1']);
    expect(result.unevaluated.filter((id: string) => id === 'flag-1')).toHaveLength(1);
  });

  it('every id in unevaluated is a member of askedFor, with no duplicates', () => {
    const raw = [
      { red_flag_id: 'flag-hallucinated', fired: true, evidence: 'not asked for' },
      { red_flag_id: 'flag-1', fired: 'bad', evidence: 'bad fired type' },
    ];

    const result = validateRedFlagResponse(raw, ['flag-1', 'flag-2']);

    const askedForSet = new Set(['flag-1', 'flag-2']);
    for (const id of result.unevaluated) {
      expect(askedForSet.has(id)).toBe(true);
    }
    expect(new Set(result.unevaluated).size).toBe(result.unevaluated.length);
    expect(result.unevaluated.sort()).toEqual(['flag-1', 'flag-2']);
  });
});

describe('redFlagCheck', () => {
  function makeRedFlag(id: string, trigger: string): RedFlag {
    return {
      id,
      symptom_id: null,
      trigger,
      applicable_classifications: ['ALL'],
      applicable_phases: ['ALL'],
      action: 'ESCALATE',
      urgency: 'urgent',
      patient_action: 'NURSE_CALLBACK',
      context_note: '',
      rationale: '',
    };
  }

  function makeTurns(): Turn[] {
    return [
      { turnNumber: 1, speaker: 'agent', originalText: 'How are you feeling?', timestamp: new Date('2025-01-01T12:00:00Z') },
      { turnNumber: 2, speaker: 'patient', originalText: 'I have chest pain.', timestamp: new Date('2025-01-01T12:01:00Z') },
    ];
  }

  function makeInput(overrides: Partial<RedFlagCheckInput> = {}): RedFlagCheckInput {
    return {
      turns: makeTurns(),
      facts: { weight: 72 },
      unresolvedFactNames: ['breathlessness_at_rest'],
      daysSinceTrigger: 3,
      currentPhase: 'phase_1',
      flags: [makeRedFlag('RF_A', 'Chest pain lasting more than 5 minutes')],
      ...overrides,
    };
  }

  function makeLlm(): jest.Mocked<LLMProvider> {
    return { complete: jest.fn(), stream: jest.fn() } as unknown as jest.Mocked<LLMProvider>;
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('makes NO call when the flag set is empty', async () => {
    const llm = makeLlm();
    const result = await redFlagCheck(makeInput({ flags: [] }), llm);

    expect(llm.complete).not.toHaveBeenCalled();
    expect(result).toEqual({ verdicts: [], evidence: new Map(), unevaluated: [] });
  });

  it('returns verdicts and evidence on a well-formed response', async () => {
    const llm = makeLlm();
    llm.complete.mockResolvedValueOnce({
      content: JSON.stringify([{ red_flag_id: 'RF_A', evidence: 'patient reports chest pain', fired: true }]),
      finishReason: 'stop',
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    });

    const result = await redFlagCheck(makeInput(), llm);

    expect(result.verdicts).toEqual([{ red_flag_id: 'RF_A', fired: true }]);
    expect(result.evidence.get('RF_A')).toBe('patient reports chest pain');
    expect(result.unevaluated).toEqual([]);
    expect(llm.complete).toHaveBeenCalledTimes(1);
  });

  it('retries a malformed response, then marks all unevaluated', async () => {
    const llm = makeLlm();
    llm.complete.mockResolvedValue({
      content: 'this is not JSON at all',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    });

    const promise = redFlagCheck(makeInput(), llm);
    // Two backoffs occur between 3 attempts (500ms, 1500ms, each +/-20% jitter).
    await jest.advanceTimersByTimeAsync(700);
    await jest.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(llm.complete).toHaveBeenCalledTimes(3);
    expect(result.verdicts).toEqual([]);
    expect(result.unevaluated).toEqual(['RF_A']);
  });

  it('does NOT retry a partial response — accepts it, gaps unevaluated', async () => {
    const llm = makeLlm();
    llm.complete.mockResolvedValueOnce({
      content: JSON.stringify([{ red_flag_id: 'RF_A', evidence: 'covered', fired: false }]),
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    });

    const result = await redFlagCheck(
      makeInput({ flags: [makeRedFlag('RF_A', 'trigger A'), makeRedFlag('RF_B', 'trigger B')] }),
      llm,
    );

    expect(llm.complete).toHaveBeenCalledTimes(1); // no retry for a partial-but-parseable response
    expect(result.verdicts).toEqual([{ red_flag_id: 'RF_A', fired: false }]);
    expect(result.unevaluated).toEqual(['RF_B']);
  });

  it('marks all unevaluated when the total budget is exhausted', async () => {
    const llm = makeLlm();
    // A 429 with a Retry-After far larger than the remaining 45s budget --
    // the second attempt must be abandoned rather than delayed past the cap.
    llm.complete.mockRejectedValueOnce(
      new LLMProviderError('rate limited', 429, 60),
    );

    const result = await redFlagCheck(makeInput(), llm);

    expect(llm.complete).toHaveBeenCalledTimes(1); // abandoned before a 2nd attempt
    expect(result.verdicts).toEqual([]);
    expect(result.unevaluated).toEqual(['RF_A']);
  });

  it('never includes Sheet 8 rule text in the prompt', async () => {
    const llm = makeLlm();
    llm.complete.mockResolvedValueOnce({
      content: JSON.stringify([{ red_flag_id: 'RF_A', evidence: 'covered', fired: false }]),
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    });

    await redFlagCheck(makeInput(), llm);

    const [messages] = llm.complete.mock.calls[0];
    const prompt = messages[0].content;

    // The prompt must be built only from Sheet 4 trigger prose (RedFlag.trigger) --
    // it must never leak rule-expression syntax, thresholds, or any hint a rule
    // was tried. These are sentinels for the kind of text a Sheet 8 expression or
    // a "rule failed" hint would contain; none of them belong in call 3's prompt.
    expect(prompt).not.toMatch(/delta\(|persists\(|n_of\(|no_reading\(/);
    expect(prompt).not.toMatch(/>=|<=/);
    expect(prompt.toLowerCase()).not.toContain('rule');
  });

  it('warns against firing a flag on an uncaptured measurement just because a related symptom is present', async () => {
    const llm = makeLlm();
    llm.complete.mockResolvedValueOnce({
      content: JSON.stringify([{ red_flag_id: 'RF_A', evidence: 'covered', fired: false }]),
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    });

    await redFlagCheck(makeInput(), llm);

    const [messages] = llm.complete.mock.calls[0];
    const prompt: string = messages[0].content;

    // This is the guard against the exact failure mode a real HF conversation
    // surfaced: a compound trigger's measurement (e.g. weight gain) was never
    // reported, but the model fired the flag anyway on the strength of other,
    // unrelated symptoms in the same trigger being present.
    expect(prompt).toContain('do not mark that red flag as fired just because other, related symptoms');
  });

  it('retries on a retryable provider error, then succeeds', async () => {
    const llm = makeLlm();
    llm.complete
      .mockRejectedValueOnce(new LLMProviderError('server error', 503))
      .mockResolvedValueOnce({
        content: JSON.stringify([{ red_flag_id: 'RF_A', evidence: 'ok now', fired: true }]),
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      });

    const promise = redFlagCheck(makeInput(), llm);
    await jest.advanceTimersByTimeAsync(700);
    const result = await promise;

    expect(llm.complete).toHaveBeenCalledTimes(2);
    expect(result.verdicts).toEqual([{ red_flag_id: 'RF_A', fired: true }]);
  });

  it('does not retry a non-retryable 4xx error', async () => {
    const llm = makeLlm();
    llm.complete.mockRejectedValueOnce(new LLMProviderError('bad request', 400));

    const result = await redFlagCheck(makeInput(), llm);

    expect(llm.complete).toHaveBeenCalledTimes(1);
    expect(result.unevaluated).toEqual(['RF_A']);
  });

  it('passes the 12s per-attempt timeout and the shared model config through to complete()', async () => {
    const llm = makeLlm();
    llm.complete.mockResolvedValueOnce({
      content: JSON.stringify([{ red_flag_id: 'RF_A', evidence: 'covered', fired: false }]),
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    });

    await redFlagCheck(makeInput(), llm);

    const [, options] = llm.complete.mock.calls[0];
    expect(options?.timeoutMs).toBe(12_000);
    // Matches calls 1 and 2's model -- this repo is OpenAI-only, no second
    // provider is introduced here (Background 10).
    expect(options?.model).toBe('gpt-4o-mini');
  });
});
