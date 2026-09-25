// Mock database and services before any imports
jest.mock('../../core/database', () => ({
  prisma: {
    clinicalEvent: { create: jest.fn() },
    callSession: { update: jest.fn() },
  },
}));

jest.mock('../../knowledge-graph/context-loader', () => ({
  contextLoader: { loadContext: jest.fn() },
}));

jest.mock('../../knowledge-graph/knowledge-graph.service', () => ({
  knowledgeGraphService: { getActiveKnowledgeGraph: jest.fn() },
}));

jest.mock('../../ai-agent/clinical/transcript-assessment.service');

import { computeAssessment, runGreeting, runTurn } from '../callables';
import { AssessmentInput, GreetingInput, TurnInput } from '../types';
import { LLMProvider } from '../../ai-agent/interfaces';
import { TranscriptAssessmentService } from '../../ai-agent/clinical/transcript-assessment.service';

const MockAssessmentService = TranscriptAssessmentService as jest.MockedClass<typeof TranscriptAssessmentService>;

const mockCtxBase = {
  patientContext: {
    currentPhase: 'phase_1', daysSinceStart: 5, isReentry: false,
    triggerType: 'surgery_date', conditionType: 'episodic', track: 'episodic',
    phaseFocus: '', phaseReview: '',
  },
  symptoms: {
    wound_swelling: {
      name: 'wound_swelling',
      severity_score: 1,
      phase_override: null,
      assessment_questions: [],
      applicable_classifications: ['ALL'],
      applicable_phases: ['ALL'],
      base_severity: 'moderate',
      notes: '',
    },
  },
  redFlags: [],
  instructions: [],
  scoringRules: { escalate_override: '', phase_override: '' },
  scoringThresholds: {
    advise: { min_score: 1, max_score: 2, action: 'ADVISE', patient_action: 'NURSE_CALLBACK' },
    escalate: { min_score: 3, action: 'ESCALATE', patient_action: 'ER_NOW' },
  },
  systemPrompt: 'test prompt',
};

const { contextLoader } = require('../../knowledge-graph/context-loader');
const { knowledgeGraphService } = require('../../knowledge-graph/knowledge-graph.service');

beforeEach(() => {
  (contextLoader.loadContext as jest.Mock).mockResolvedValue(mockCtxBase);
  (knowledgeGraphService.getActiveKnowledgeGraph as jest.Mock).mockResolvedValue({
    facts: {}, rules: [], red_flags: [],
  });
});

describe('computeAssessment', () => {
  const mockLlm: LLMProvider = { complete: jest.fn(), stream: jest.fn() as any };

  const mockAssessmentOutput = {
    outcome: 'ESCALATE' as const,
    patient_action: 'ER_NOW' as const,
    overall_risk_level: 'CRITICAL' as const,
    symptoms: [{ name: 'chest pain', severity: 'severe' as const, risk: 'CRITICAL' as const, flag: 'red' as const }],
    escalation_reason: 'Severe chest pain requires immediate attention.',
    escalation_required: true,
  };

  beforeEach(() => {
    MockAssessmentService.prototype.assess = jest.fn().mockResolvedValue({
      assessment: mockAssessmentOutput,
      scoredEvents: [],
    });
  });

  const baseInput: AssessmentInput = {
    condition: 'cardiac_surgery',
    classification: 'CABG',
    phase: 'phase_1',
    days_since_start: 5,
    locale: 'en-IN',
    transcript: [
      { role: 'assistant', content: 'How are you feeling?' },
      { role: 'user',      content: 'I have severe chest pain.' },
    ],
  };

  it('returns assessment output from TranscriptAssessmentService', async () => {
    const result = await computeAssessment(baseInput, mockLlm);
    expect(result).toEqual(mockAssessmentOutput);
  });

  it('converts ChatMessage[] to Turn[] and passes to assess()', async () => {
    await computeAssessment(baseInput, mockLlm);
    const passedTurns = (MockAssessmentService.prototype.assess as jest.Mock).mock.calls[0][0];
    expect(passedTurns).toHaveLength(2);
    expect(passedTurns[0]).toMatchObject({ turnNumber: 1, speaker: 'agent',   originalText: 'How are you feeling?' });
    expect(passedTurns[1]).toMatchObject({ turnNumber: 2, speaker: 'patient', originalText: 'I have severe chest pain.' });
  });
});

describe('runGreeting', () => {
  const mockLlmResponse = {
    content: 'Hello! I am Asha calling to check on you.',
    finishReason: 'stop',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
  };

  const mockLlm: LLMProvider = {
    complete: jest.fn().mockResolvedValue(mockLlmResponse),
    stream: jest.fn() as any,
  };

  beforeEach(() => jest.clearAllMocks());

  it('throws when loadContext returns null', async () => {
    (contextLoader.loadContext as jest.Mock).mockResolvedValueOnce(null);
    await expect(
      runGreeting(
        { condition: 'cardiac_surgery', classification: 'CABG', phase: 'phase_1', days_since_start: 5, locale: 'en-IN' },
        mockLlm,
      )
    ).rejects.toThrow('No active knowledge graph found for condition: cardiac_surgery');
  });

  it('calls LLM with system prompt as the only message (no user turns)', async () => {
    (contextLoader.loadContext as jest.Mock).mockResolvedValueOnce(mockCtxBase);
    const result = await runGreeting(
      { condition: 'cardiac_surgery', classification: 'CABG', phase: 'phase_1', days_since_start: 5, locale: 'en-IN' },
      mockLlm,
    );
    const callArgs = (mockLlm.complete as jest.Mock).mock.calls[0][0] as import('../../ai-agent/interfaces').ChatMessage[];
    expect(callArgs).toHaveLength(1);
    expect(callArgs[0].role).toBe('system');
    expect(result.nurse_greeting).toBe('Hello! I am Asha calling to check on you.');
    expect(result.system_prompt_used).toBe('test prompt');
  });
});

describe('runTurn', () => {
  const nurseResponseContent = 'I understand you have swelling. How long has this been present?';
  const topicsContent = '["wound_swelling"]';

  const makeMockLlm = (firstContent: string, secondContent: string): LLMProvider => ({
    complete: jest.fn()
      .mockResolvedValueOnce({
        content: firstContent,
        finishReason: 'stop',
        usage: { promptTokens: 20, completionTokens: 40, totalTokens: 60 },
      })
      .mockResolvedValueOnce({
        content: secondContent,
        finishReason: 'stop',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      }),
    stream: jest.fn() as any,
  });

  const baseTurnInput: TurnInput = {
    condition: 'cardiac_surgery',
    classification: 'CABG',
    phase: 'phase_1',
    days_since_start: 5,
    locale: 'en-IN',
    history: [
      { role: 'assistant', content: 'Hello! How are you feeling?' },
      { role: 'user', content: 'I have some swelling around my wound.' },
    ],
  };

  beforeEach(() => {
    (contextLoader.loadContext as jest.Mock).mockResolvedValue(mockCtxBase);
  });

  it('throws when loadContext returns null', async () => {
    (contextLoader.loadContext as jest.Mock).mockResolvedValueOnce(null);
    const mockLlm = makeMockLlm('', '');
    await expect(runTurn(baseTurnInput, mockLlm)).rejects.toThrow(
      'No active knowledge graph found for condition: cardiac_surgery'
    );
  });

  it('makes two LLM calls: nurse response then topic extraction', async () => {
    const mockLlm = makeMockLlm(nurseResponseContent, topicsContent);
    await runTurn(baseTurnInput, mockLlm);
    expect((mockLlm.complete as jest.Mock).mock.calls).toHaveLength(2);
  });

  it('first call includes system prompt followed by history', async () => {
    const mockLlm = makeMockLlm(nurseResponseContent, topicsContent);
    await runTurn(baseTurnInput, mockLlm);
    const firstCallMessages = (mockLlm.complete as jest.Mock).mock.calls[0][0] as import('../../ai-agent/interfaces').ChatMessage[];
    expect(firstCallMessages[0].role).toBe('system');
    expect(firstCallMessages[0].content).toBe('test prompt');
    expect(firstCallMessages.slice(1)).toEqual(baseTurnInput.history);
  });

  it('returns empty topics_covered when extraction response is invalid JSON', async () => {
    const mockLlm = makeMockLlm(nurseResponseContent, 'not valid json at all');
    const result = await runTurn(baseTurnInput, mockLlm);
    expect(result.nurse_response).toBe(nurseResponseContent);
    expect(result.topics_covered).toEqual([]);
  });
});
