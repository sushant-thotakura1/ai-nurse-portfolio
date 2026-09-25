import { FactExtractor } from '../fact-extractor';
import { LLMProvider } from '../../ai-agent/interfaces';
import { Fact } from '../../knowledge-graph/types';
import { Turn } from '../../orchestrator/session';

const mockLlm: LLMProvider = { complete: jest.fn(), stream: jest.fn() as any };

function makeFact(overrides: Partial<Fact> = {}): Fact {
  return {
    display_name: 'Test Fact',
    area: 'vitals',
    type: 'number',
    unit: 'kg',
    valid_for: '1d',
    valid_for_hours: 24,
    required: false,
    applicable_classifications: ['ALL'],
    applicable_phases: ['ALL'],
    extraction_hint: null,
    ...overrides,
  };
}

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    turnNumber: 1,
    speaker: 'patient',
    originalText: 'test text',
    timestamp: new Date('2025-01-10T12:00:00Z'),
    ...overrides,
  };
}

function mockLlmResponse(data: Record<string, any>): void {
  (mockLlm.complete as jest.Mock).mockResolvedValue({
    content: JSON.stringify(data),
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('FactExtractor', () => {
  const extractor = new FactExtractor(mockLlm);

  // Test 1: Empty applicable facts → no LLM call, returns []
  it('returns [] and does not call LLM when no facts are applicable', async () => {
    const facts: Record<string, Fact> = {
      weight: makeFact({
        applicable_classifications: ['COPD'],
        applicable_phases: ['ALL'],
      }),
    };
    const turns: Turn[] = [
      makeTurn({ speaker: 'patient', originalText: 'I weigh 70 kg' }),
    ];

    const result = await extractor.extract(facts, 'HEART_FAILURE', 'phase_1', turns);

    expect(mockLlm.complete).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  // Test 2: Prompt is built from filtered applicable facts only
  it('only includes applicable facts in the prompt', async () => {
    const facts: Record<string, Fact> = {
      weight: makeFact({
        display_name: 'Weight',
        applicable_classifications: ['HEART_FAILURE'],
        applicable_phases: ['ALL'],
      }),
      bp_systolic: makeFact({
        display_name: 'Systolic BP',
        applicable_classifications: ['COPD'],
        applicable_phases: ['ALL'],
      }),
    };
    mockLlmResponse({ weight: { value: 72, extractionClass: 'CONFIDENT' } });

    const turns: Turn[] = [
      makeTurn({ speaker: 'patient', originalText: 'My weight is 72 kg' }),
    ];
    await extractor.extract(facts, 'HEART_FAILURE', 'phase_1', turns);

    const calledMessages = (mockLlm.complete as jest.Mock).mock.calls[0][0];
    const prompt: string = calledMessages[0].content;

    expect(prompt).toContain('weight');
    expect(prompt).not.toContain('bp_systolic');
  });

  // Test 3: Prompt NEVER contains thresholds, rules, or actions (the boundary test)
  it('does not include thresholds, rules, or action keywords in the prompt', async () => {
    const facts: Record<string, Fact> = {
      weight: makeFact({
        extraction_hint: 'Ask for weight in kg',
        applicable_classifications: ['ALL'],
        applicable_phases: ['ALL'],
      }),
    };
    mockLlmResponse({ weight: { value: 72, extractionClass: 'CONFIDENT' } });

    const turns: Turn[] = [
      makeTurn({ speaker: 'patient', originalText: 'My weight is 72 kg' }),
    ];
    await extractor.extract(facts, 'HEART_FAILURE', 'phase_1', turns);

    const calledMessages = (mockLlm.complete as jest.Mock).mock.calls[0][0];
    const prompt: string = calledMessages[0].content;

    expect(prompt).toContain('Ask for weight in kg');
    expect(prompt).not.toContain('ESCALATE');
    expect(prompt).not.toContain('ADVISE');
    expect(prompt).not.toContain('REASSURE');
    expect(prompt).not.toContain('threshold');
    expect(prompt).not.toContain('ER_NOW');
    expect(prompt).not.toContain('NURSE_CALLBACK');
    expect(prompt).not.toContain('FACILITY_TODAY');
  });

  // Test 4: NOT_ASKED for facts absent from LLM response
  it('marks absent facts as NOT_ASKED with null value', async () => {
    const facts: Record<string, Fact> = {
      weight: makeFact({
        applicable_classifications: ['ALL'],
        applicable_phases: ['ALL'],
      }),
      breathlessness: makeFact({
        type: 'boolean',
        unit: undefined,
        applicable_classifications: ['ALL'],
        applicable_phases: ['ALL'],
      }),
    };
    mockLlmResponse({ weight: { value: 72, extractionClass: 'CONFIDENT' } });

    const turns: Turn[] = [
      makeTurn({ speaker: 'patient', originalText: 'My weight is 72 kg' }),
    ];
    const result = await extractor.extract(facts, 'HEART_FAILURE', 'phase_1', turns);

    expect(result).toHaveLength(2);
    const weightResult = result.find(r => r.machineName === 'weight')!;
    const breathResult = result.find(r => r.machineName === 'breathlessness')!;

    expect(weightResult.extractionClass).toBe('CONFIDENT');
    expect(breathResult.extractionClass).toBe('NOT_ASKED');
    expect(breathResult.value).toBeNull();
  });

  // Test 5: observedAt defaults to last patient turn's timestamp
  it('sets observedAt to the last patient turn timestamp, not the last overall turn', async () => {
    const T1 = new Date('2025-01-10T08:00:00Z');
    const T2 = new Date('2025-01-10T10:00:00Z');
    const T3 = new Date('2025-01-10T12:00:00Z');

    const facts: Record<string, Fact> = {
      weight: makeFact({
        applicable_classifications: ['ALL'],
        applicable_phases: ['ALL'],
      }),
    };
    mockLlmResponse({ weight: { value: 72, extractionClass: 'CONFIDENT' } });

    const turns: Turn[] = [
      makeTurn({ turnNumber: 1, speaker: 'agent',   originalText: 'Hello',        timestamp: T1 }),
      makeTurn({ turnNumber: 2, speaker: 'patient', originalText: 'I weigh 72 kg', timestamp: T2 }),
      makeTurn({ turnNumber: 3, speaker: 'agent',   originalText: 'Thank you',     timestamp: T3 }),
    ];
    const result = await extractor.extract(facts, 'HEART_FAILURE', 'phase_1', turns);

    expect(result[0].observedAt).toEqual(T2);
  });

  // Test 6: Volunteered time yields non-zero timeUncertaintyHours and offset observedAt
  it('applies timeOffsetHours to observedAt and sets timeUncertaintyHours', async () => {
    const patientTimestamp = new Date('2025-01-10T12:00:00Z');
    const expectedObservedAt = new Date('2025-01-08T12:00:00Z'); // 12:00 minus 48h

    const facts: Record<string, Fact> = {
      weight: makeFact({
        applicable_classifications: ['ALL'],
        applicable_phases: ['ALL'],
      }),
    };
    mockLlmResponse({
      weight: { value: 70, extractionClass: 'CONFIDENT', timeOffsetHours: 48 },
    });

    const turns: Turn[] = [
      makeTurn({
        speaker: 'patient',
        originalText: 'Two days ago I weighed 70 kg',
        timestamp: patientTimestamp,
      }),
    ];
    const result = await extractor.extract(facts, 'HEART_FAILURE', 'phase_1', turns);

    expect(result[0].observedAt).toEqual(expectedObservedAt);
    expect(result[0].timeUncertaintyHours).toBe(48);
  });

  // Test 6b: boolean-as-string — "false" must NOT be coerced to true
  it('handles boolean fact where LLM returns string "false" correctly', async () => {
    const facts: Record<string, Fact> = {
      breathlessness: makeFact({
        type: 'boolean',
        unit: undefined,
        applicable_classifications: ['ALL'],
        applicable_phases: ['ALL'],
      }),
    };
    mockLlmResponse({
      breathlessness: { value: 'false', extractionClass: 'CONFIDENT' },
    });

    const turns: Turn[] = [makeTurn({ speaker: 'patient', originalText: 'No breathlessness' })];
    const result = await extractor.extract(facts, 'HEART_FAILURE', 'phase_1', turns);

    expect(result[0].value).toBe(false);
    expect(result[0].extractionClass).toBe('CONFIDENT');
  });

  // Test 6c: prompt instructs against cross-attributing one fact's volunteered
  // time offset to a different, unrelated fact. A mocked test can't prove the
  // LLM obeys this -- it proves the instruction is actually sent, same
  // boundary-check pattern as Test 3.
  it('instructs the model not to attach one fact\'s timing to another fact', async () => {
    const facts: Record<string, Fact> = {
      vomiting: makeFact({ type: 'boolean', unit: undefined, applicable_classifications: ['ALL'], applicable_phases: ['ALL'] }),
      breathlessness_worsening_trend: makeFact({ type: 'boolean', unit: undefined, applicable_classifications: ['ALL'], applicable_phases: ['ALL'] }),
    };
    mockLlmResponse({
      vomiting: { value: true, extractionClass: 'CONFIDENT', timeOffsetHours: 72 },
    });

    const turns: Turn[] = [
      makeTurn({ speaker: 'patient', originalText: "I've been vomiting for 3 days and also get breathless on the stairs" }),
    ];
    await extractor.extract(facts, 'HEART_FAILURE', 'phase_1', turns);

    const calledMessages = (mockLlm.complete as jest.Mock).mock.calls[0][0];
    const prompt: string = calledMessages[0].content;

    expect(prompt).toContain('timeOffsetHours must come ONLY from what the patient said about THAT fact specifically');
    expect(prompt).toContain('Do not attach a time mentioned for one symptom or topic to a different, unrelated fact');
  });

  // Test 7: ALL wildcard on applicable_classifications and applicable_phases
  it('includes facts with ALL wildcard for both classifications and phases', async () => {
    const facts: Record<string, Fact> = {
      weight: makeFact({
        applicable_classifications: ['ALL'],
        applicable_phases: ['ALL'],
      }),
    };
    mockLlmResponse({ weight: { value: 72, extractionClass: 'CONFIDENT' } });

    const turns: Turn[] = [
      makeTurn({ speaker: 'patient', originalText: 'My weight is 72 kg' }),
    ];
    const result = await extractor.extract(facts, 'ANY_CLASSIFICATION', 'any_phase', turns);

    expect(mockLlm.complete).toHaveBeenCalled();
    const calledMessages = (mockLlm.complete as jest.Mock).mock.calls[0][0];
    const prompt: string = calledMessages[0].content;
    expect(prompt).toContain('weight');
    expect(result.some(r => r.machineName === 'weight')).toBe(true);
  });
});
