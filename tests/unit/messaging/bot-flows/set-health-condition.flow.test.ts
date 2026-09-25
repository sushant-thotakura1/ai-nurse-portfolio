import { SetHealthConditionFlow } from '../../../../src/messaging/bot-flows/set-health-condition.flow';

const mockAdapter = {
  sendMessage: jest.fn().mockResolvedValue(undefined),
  parseWebhook: jest.fn(),
  verifyWebhook: jest.fn(),
};

const mockLlm = {
  complete: jest.fn().mockResolvedValue({ content: 'Hello patient! This is Nurse Maya.' }),
  stream: jest.fn(),
};

const mockPrisma = {
  knowledgeGraph: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  patient: {
    update: jest.fn().mockResolvedValue({}),
  },
  messageSession: {
    update: jest.fn().mockResolvedValue({}),
  },
};

const baseSession = {
  id: 'session-1',
  channel: 'whatsapp',
  senderId: '+919876543210',
  flowState: null,
  transcript: [],
};

const patient = { id: 'patient-1', encryptedName: null };
const tenantId = 'tenant-abc';

// A KG with phase data for non-hybrid (episodic) condition
const makeEpisodicKg = (overrides: any = {}) => ({
  id: 'kg-1',
  condition: 'Cardiac Surgery',
  jsonData: {
    condition: {
      condition_type: 'episodic',
      classifications: {
        CABG: {
          phases: {
            'Phase I': { name: 'Phase I', day_range: [0, 7], day_range_type: 'fixed' },
            'Phase II': { name: 'Phase II', day_range: [8, 30], day_range_type: 'fixed' },
            'Phase III': { name: 'Phase III', day_range: [31, null], day_range_type: 'open' },
          },
        },
        VALVE: {
          phases: {
            'Phase I': { name: 'Phase I', day_range: [0, 7], day_range_type: 'fixed' },
          },
        },
      },
    },
  },
  ...overrides,
});

// A hybrid KG (e.g. Sickle Cell) with track-tagged phases
const makeHybridKg = (overrides: any = {}) => ({
  id: 'kg-sca',
  condition: 'Sickle Cell Anemia',
  jsonData: {
    condition: {
      condition_type: 'hybrid',
      classifications: {
        HbSS: {
          phases: {
            'Phase I:episodic': { name: 'Phase I — Acute Recovery', day_range: [0, 14], day_range_type: 'fixed', track: 'episodic' },
            'Phase I:chronic':  { name: 'Phase I — Baseline Assessment', day_range: [0, 30], day_range_type: 'fixed', track: 'chronic' },
            'Phase II:hybrid':  { name: 'Phase II — Ongoing Monitoring', day_range: [31, null], day_range_type: 'open', track: 'hybrid' },
          },
        },
      },
    },
  },
  ...overrides,
});

describe('SetHealthConditionFlow', () => {
  let flow: SetHealthConditionFlow;

  beforeEach(() => {
    flow = new SetHealthConditionFlow();
    jest.clearAllMocks();
  });

  // ── isActive ──────────────────────────────────────────────────────────────

  describe('isActive', () => {
    it('returns false when flowState is null', () => {
      expect(flow.isActive({ flowState: null })).toBe(false);
    });

    it('returns true when flowState.flow matches', () => {
      expect(flow.isActive({ flowState: { flow: 'set_health_condition' } })).toBe(true);
    });

    it('returns false for a different flow', () => {
      expect(flow.isActive({ flowState: { flow: 'other_flow' } })).toBe(false);
    });
  });

  // ── trigger ───────────────────────────────────────────────────────────────

  describe('trigger — step 1', () => {
    it('sends condition list when active KGs exist', async () => {
      mockPrisma.knowledgeGraph.findMany.mockResolvedValue([
        makeEpisodicKg({ id: 'kg-1', condition: 'Cardiac Surgery' }),
        makeEpisodicKg({ id: 'kg-2', condition: 'Heart Failure' }),
      ]);

      await flow.handle(baseSession, 'Set Health Condition', patient, tenantId, mockPrisma, mockAdapter, mockLlm);

      expect(mockPrisma.messageSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            flowState: expect.objectContaining({ step: 'awaiting_condition' }),
          }),
        }),
      );
      expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: [expect.objectContaining({ interactive: expect.objectContaining({ type: 'list' }) })],
        }),
      );
    });

    it('sends fallback message when no active KGs exist', async () => {
      mockPrisma.knowledgeGraph.findMany.mockResolvedValue([]);

      await flow.handle(baseSession, 'Set Health Condition', patient, tenantId, mockPrisma, mockAdapter, mockLlm);

      expect(mockPrisma.messageSession.update).not.toHaveBeenCalled();
      expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: [expect.objectContaining({ text: expect.stringContaining('No health conditions') })],
        }),
      );
    });
  });

  // ── awaiting_condition (non-hybrid) ───────────────────────────────────────

  describe('awaiting_condition — non-hybrid condition selected', () => {
    const sessionWithConditionStep = {
      ...baseSession,
      flowState: { flow: 'set_health_condition', step: 'awaiting_condition' },
    };

    it('advances to awaiting_classification for episodic KG with multiple classifications', async () => {
      mockPrisma.knowledgeGraph.findFirst.mockResolvedValue(makeEpisodicKg());

      await flow.handle(sessionWithConditionStep, 'kg-1', patient, tenantId, mockPrisma, mockAdapter, mockLlm);

      expect(mockPrisma.messageSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            flowState: expect.objectContaining({
              step: 'awaiting_classification',
              kgId: 'kg-1',
              conditionName: 'Cardiac Surgery',
              track: 'episodic',
              triggerType: 'discharge_date',
            }),
          }),
        }),
      );
      expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: [expect.objectContaining({ interactive: expect.objectContaining({ type: 'list' }) })],
        }),
      );
    });

    it('skips to awaiting_phase for episodic KG with one classification (includes phases + track)', async () => {
      mockPrisma.knowledgeGraph.findFirst.mockResolvedValue(
        makeEpisodicKg({
          jsonData: {
            condition: {
              condition_type: 'episodic',
              classifications: {
                CABG: {
                  phases: {
                    'Phase I': { name: 'Phase I', day_range: [0, 7], day_range_type: 'fixed' },
                  },
                },
              },
            },
          },
        }),
      );

      await flow.handle(sessionWithConditionStep, 'kg-1', patient, tenantId, mockPrisma, mockAdapter, mockLlm);

      const updateCall = (mockPrisma.messageSession.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.flowState.step).toBe('awaiting_phase');
      expect(updateCall.data.flowState.track).toBe('episodic');
      expect(updateCall.data.flowState.triggerType).toBe('discharge_date');
      expect(updateCall.data.flowState.phases).toHaveLength(1);
      expect(updateCall.data.flowState.phases[0].id).toBe('phase_1');
    });

    it('re-sends condition list when KG is not found', async () => {
      mockPrisma.knowledgeGraph.findFirst.mockResolvedValue(null);
      mockPrisma.knowledgeGraph.findMany.mockResolvedValue([makeEpisodicKg()]);

      await flow.handle(sessionWithConditionStep, 'invalid-id', patient, tenantId, mockPrisma, mockAdapter, mockLlm);

      expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: [expect.objectContaining({ interactive: expect.objectContaining({ type: 'list' }) })],
        }),
      );
    });
  });

  // ── awaiting_condition (hybrid) ───────────────────────────────────────────

  describe('awaiting_condition — hybrid condition selected', () => {
    const sessionWithConditionStep = {
      ...baseSession,
      flowState: { flow: 'set_health_condition', step: 'awaiting_condition' },
    };

    it('writes awaiting_track state with classifications and retryCount:0', async () => {
      mockPrisma.knowledgeGraph.findFirst.mockResolvedValue(makeHybridKg());

      await flow.handle(sessionWithConditionStep, 'kg-sca', patient, tenantId, mockPrisma, mockAdapter, mockLlm);

      expect(mockPrisma.messageSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            flowState: expect.objectContaining({
              step: 'awaiting_track',
              kgId: 'kg-sca',
              conditionName: 'Sickle Cell Anemia',
              conditionType: 'hybrid',
              classifications: ['HbSS'],
              retryCount: 0,
            }),
          }),
        }),
      );
    });

    it('sends two-button interactive message for track selection', async () => {
      mockPrisma.knowledgeGraph.findFirst.mockResolvedValue(makeHybridKg());

      await flow.handle(sessionWithConditionStep, 'kg-sca', patient, tenantId, mockPrisma, mockAdapter, mockLlm);

      expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: [
            expect.objectContaining({
              interactive: expect.objectContaining({
                type: 'button',
                buttons: expect.arrayContaining([
                  expect.objectContaining({ id: 'track_episodic' }),
                  expect.objectContaining({ id: 'track_chronic' }),
                ]),
              }),
            }),
          ],
        }),
      );
    });
  });

  // ── awaiting_track ────────────────────────────────────────────────────────

  describe('awaiting_track — hybrid track selected', () => {
    const sessionWithTrackStep = (classifications: string[], retryCount = 0) => ({
      ...baseSession,
      flowState: {
        flow: 'set_health_condition',
        step: 'awaiting_track',
        kgId: 'kg-sca',
        conditionName: 'Sickle Cell Anemia',
        conditionType: 'hybrid',
        classifications,
        retryCount,
      },
    });

    it('selects episodic track and advances to awaiting_classification (multi-classification)', async () => {
      mockPrisma.knowledgeGraph.findFirst.mockResolvedValue(
        makeHybridKg({
          jsonData: {
            condition: {
              condition_type: 'hybrid',
              classifications: {
                HbSS: { phases: { 'Phase I:episodic': { name: 'P1', day_range: [0, 14], day_range_type: 'fixed', track: 'episodic' } } },
                HbSC: { phases: { 'Phase I:episodic': { name: 'P1', day_range: [0, 14], day_range_type: 'fixed', track: 'episodic' } } },
              },
            },
          },
        }),
      );

      await flow.handle(sessionWithTrackStep(['HbSS', 'HbSC']), 'track_episodic', patient, tenantId, mockPrisma, mockAdapter, mockLlm);

      expect(mockPrisma.messageSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            flowState: expect.objectContaining({
              step: 'awaiting_classification',
              track: 'episodic',
              triggerType: 'discharge_date',
            }),
          }),
        }),
      );
    });

    it('selects chronic track and advances to awaiting_phase directly (single classification)', async () => {
      mockPrisma.knowledgeGraph.findFirst.mockResolvedValue(makeHybridKg());

      await flow.handle(sessionWithTrackStep(['HbSS']), 'track_chronic', patient, tenantId, mockPrisma, mockAdapter, mockLlm);

      const updateCall = (mockPrisma.messageSession.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.flowState.step).toBe('awaiting_phase');
      expect(updateCall.data.flowState.track).toBe('chronic');
      expect(updateCall.data.flowState.triggerType).toBe('enrollment_date');
      // Chronic phases only: Phase I:chronic and Phase II:hybrid — should have 2
      expect(updateCall.data.flowState.phases).toHaveLength(2);
    });

    it('increments retryCount on invalid input and re-sends track buttons', async () => {
      await flow.handle(sessionWithTrackStep(['HbSS'], 0), 'garbage', patient, tenantId, mockPrisma, mockAdapter, mockLlm);

      const updateCall = (mockPrisma.messageSession.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.flowState.retryCount).toBe(1);
      expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: [expect.objectContaining({ interactive: expect.objectContaining({ type: 'button' }) })],
        }),
      );
    });

    it('cancels after 3 invalid inputs', async () => {
      await flow.handle(sessionWithTrackStep(['HbSS'], 2), 'garbage', patient, tenantId, mockPrisma, mockAdapter, mockLlm);

      expect(mockPrisma.messageSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ flowState: null }) }),
      );
      expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: [expect.objectContaining({ text: expect.stringContaining('Too many') })],
        }),
      );
    });
  });

  // ── awaiting_phase (KG-sourced) ───────────────────────────────────────────

  describe('awaiting_phase — KG-sourced phases', () => {
    const phases = [
      { id: 'phase_1', label: 'Phase I', daysStart: 0, daysEnd: 7 },
      { id: 'phase_2', label: 'Phase II', daysStart: 8, daysEnd: 30 },
      { id: 'phase_3', label: 'Phase III', daysStart: 31, daysEnd: null },
    ];

    const sessionWithPhaseStep = (triggerType = 'discharge_date') => ({
      ...baseSession,
      flowState: {
        flow: 'set_health_condition',
        step: 'awaiting_phase',
        kgId: 'kg-1',
        conditionName: 'Cardiac Surgery',
        conditionType: 'episodic',
        track: 'episodic',
        triggerType,
        selectedClassification: 'CABG',
        phases,
      },
    });

    it('updates patient with triggerType and conditionStartDate from day_range midpoint', async () => {
      await flow.handle(sessionWithPhaseStep(), 'phase_1', patient, tenantId, mockPrisma, mockAdapter, mockLlm);

      const updateCall = (mockPrisma.patient.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.triggerType).toBe('discharge_date');
      expect(updateCall.data.condition).toBe('Cardiac Surgery');
      expect(updateCall.data.classification).toBe('CABG');
      expect(updateCall.data.knowledgeGraphId).toBe('kg-1');

      // phase_1: daysStart=0, daysEnd=7 → midpoint = round((0+7)/2) = 4 days ago
      const expectedDate = new Date();
      expectedDate.setUTCDate(expectedDate.getUTCDate() - 4);
      expectedDate.setUTCHours(0, 0, 0, 0);
      const actualDate = new Date(updateCall.data.conditionStartDate);
      expect(actualDate.toISOString().slice(0, 10)).toBe(expectedDate.toISOString().slice(0, 10));
    });

    it('uses daysStart + 7 for open-ended phase (daysEnd === null)', async () => {
      await flow.handle(sessionWithPhaseStep(), 'phase_3', patient, tenantId, mockPrisma, mockAdapter, mockLlm);

      const updateCall = (mockPrisma.patient.update as jest.Mock).mock.calls[0][0];
      // phase_3: daysStart=31, daysEnd=null → 31 + 7 = 38 days ago
      const expectedDate = new Date();
      expectedDate.setUTCDate(expectedDate.getUTCDate() - 38);
      expectedDate.setUTCHours(0, 0, 0, 0);
      const actualDate = new Date(updateCall.data.conditionStartDate);
      expect(actualDate.toISOString().slice(0, 10)).toBe(expectedDate.toISOString().slice(0, 10));
    });

    it('stores triggerType for chronic patient', async () => {
      await flow.handle(sessionWithPhaseStep('enrollment_date'), 'phase_2', patient, tenantId, mockPrisma, mockAdapter, mockLlm);

      const updateCall = (mockPrisma.patient.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.data.triggerType).toBe('enrollment_date');
    });

    it('clears flowState and sends greeting after phase selection', async () => {
      await flow.handle(sessionWithPhaseStep(), 'phase_2', patient, tenantId, mockPrisma, mockAdapter, mockLlm);

      expect(mockPrisma.messageSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ flowState: null }) }),
      );
      expect(mockLlm.complete).toHaveBeenCalledTimes(1);
      expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ content: [expect.objectContaining({ text: 'Hello patient! This is Nurse Maya.' })] }),
      );
    });

    it('re-sends phase list (interactive list) for unknown phase id', async () => {
      await flow.handle(sessionWithPhaseStep(), 'invalid-phase', patient, tenantId, mockPrisma, mockAdapter, mockLlm);

      expect(mockPrisma.patient.update).not.toHaveBeenCalled();
      expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: [expect.objectContaining({ interactive: expect.objectContaining({ type: 'list' }) })],
        }),
      );
    });
  });

  // ── cancellation ──────────────────────────────────────────────────────────

  describe('cancellation', () => {
    it('clears flowState when user types cancel', async () => {
      const activeSession = {
        ...baseSession,
        flowState: {
          flow: 'set_health_condition',
          step: 'awaiting_phase',
          kgId: 'kg-1',
          conditionName: 'Cardiac Surgery',
          track: 'episodic',
          triggerType: 'discharge_date',
          phases: [],
        },
      };

      await flow.handle(activeSession, 'cancel', patient, tenantId, mockPrisma, mockAdapter, mockLlm);

      expect(mockPrisma.messageSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ flowState: null }) }),
      );
      expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: [expect.objectContaining({ text: expect.stringContaining('Cancelled') })],
        }),
      );
    });
  });
});
