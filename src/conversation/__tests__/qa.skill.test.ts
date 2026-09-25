import { QASkill } from '../skills/qa.skill';
import { MessageState } from '../../messaging/session';
import { SessionContext } from '../conversation-skill';

function makeContext(message = 'Can I eat bananas?', locale = 'en-IN'): SessionContext {
  return {
    patientId: 'p1',
    condition: 'Heart Failure',
    classification: 'HFpEF',
    currentPhase: 'PHASE_II:episodic',
    locale,
    recentTranscript: [],
    sessionState: MessageState.CONVERSATION,
    currentMessage: message,
    detectedLocale: null,
    clinicalCtx: null,
    transcriptHistory: [],
    isFirstConversationTurn: false,
    patientName: null,
  };
}

const highSimilarityResult = {
  documentId: 'doc1',
  documentTitle: 'Heart Failure Diet Guide',
  chunkIndex: 0,
  chunkText: 'Limit sodium to 2g per day.',
  similarity: 0.85,
};

const lowSimilarityResult = {
  documentId: 'doc2',
  documentTitle: 'Irrelevant',
  chunkIndex: 0,
  chunkText: 'Random text.',
  similarity: 0.15,
};

describe('QASkill', () => {
  let mockRagService: any;
  let mockLlm: any;

  beforeEach(() => {
    mockRagService = { queryDocuments: jest.fn() };
    mockLlm = { complete: jest.fn(), stream: jest.fn() };
  });

  const makeSkill = () => new QASkill(mockRagService, mockLlm);

  it('has correct name and description', () => {
    const skill = makeSkill();
    expect(skill.name).toBe('qa');
    expect(skill.description).toContain('question');
  });

  it('returns isEmpty=true when no results above similarity threshold', async () => {
    mockRagService.queryDocuments.mockResolvedValue([lowSimilarityResult]);
    const fragment = await makeSkill().execute(makeContext(), null);
    expect(fragment.isEmpty).toBe(true);
    expect(fragment.skillName).toBe('qa');
    expect(fragment.priority).toBe(5);
  });

  it('returns isEmpty=true when queryDocuments returns empty array', async () => {
    mockRagService.queryDocuments.mockResolvedValue([]);
    const fragment = await makeSkill().execute(makeContext(), null);
    expect(fragment.isEmpty).toBe(true);
    expect(fragment.priority).toBe(5);
  });

  it('returns formatted document chunks when results above threshold', async () => {
    mockRagService.queryDocuments.mockResolvedValue([highSimilarityResult]);
    const fragment = await makeSkill().execute(makeContext(), null);
    expect(fragment.isEmpty).toBe(false);
    expect(fragment.content).toContain('Heart Failure Diet Guide');
    expect(fragment.content).toContain('Limit sodium to 2g per day.');
    expect(fragment.content).toContain('Reference Documents');
    expect(fragment.priority).toBe(5);
  });

  it('queries with the condition-enriched message (English locale — no translation)', async () => {
    mockRagService.queryDocuments.mockResolvedValue([]);
    await makeSkill().execute(makeContext('Can I eat bananas?'), null);
    expect(mockRagService.queryDocuments).toHaveBeenCalledWith(
      'Heart Failure patient: Can I eat bananas?', 3, expect.anything(),
    );
    expect(mockLlm.complete).not.toHaveBeenCalled();
  });

  it('translates a non-English question to English before retrieval', async () => {
    mockLlm.complete.mockResolvedValue({ content: 'What should I do if someone gets burned?' });
    mockRagService.queryDocuments.mockResolvedValue([highSimilarityResult]);

    await makeSkill().execute(makeContext('Me zan yi idan wani ya kone?', 'ha-NG'), null);

    expect(mockLlm.complete).toHaveBeenCalledTimes(1);
    expect(mockRagService.queryDocuments).toHaveBeenCalledWith(
      'Heart Failure patient: What should I do if someone gets burned?', 3, expect.anything(),
    );
  });

  it('falls back to the original message when translation fails', async () => {
    mockLlm.complete.mockRejectedValue(new Error('LLM down'));
    mockRagService.queryDocuments.mockResolvedValue([]);

    await makeSkill().execute(makeContext('Me zan yi idan wani ya kone?', 'ha-NG'), null);

    expect(mockRagService.queryDocuments).toHaveBeenCalledWith(
      'Heart Failure patient: Me zan yi idan wani ya kone?', 3, expect.anything(),
    );
  });

  it('passes a RagTracer to queryDocuments', async () => {
    mockRagService.queryDocuments.mockResolvedValue([highSimilarityResult]);
    await makeSkill().execute(makeContext(), null);

    expect(mockRagService.queryDocuments).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Number),
      expect.objectContaining({
        recordFilter: expect.any(Function),
        recordSearch: expect.any(Function),
      }),
    );
  });

  it('returns isEmpty=true when queryDocuments throws', async () => {
    mockRagService.queryDocuments.mockRejectedValue(new Error('DB error'));
    const fragment = await makeSkill().execute(makeContext(), null);
    expect(fragment.isEmpty).toBe(true);
  });
});
