jest.mock('../../core/database', () => ({
  prisma: {
    clinicalEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

import { ClinicalAssessmentService } from '../clinical-assessment.service';

const svc = new ClinicalAssessmentService() as any;

describe('checkPhaseOverride — typed object form', () => {
  it('returns REASSURE when phase key matches and action is REASSURE', () => {
    const symptom = {
      phase_override: {
        phase_1: { action: 'REASSURE', note: 'Expected at this phase' },
      },
    };
    expect(svc.checkPhaseOverride(symptom, 'phase_1')).toEqual({
      outcome: 'REASSURE',
      reasoning: 'Expected at this phase',
    });
  });

  it('returns ESCALATE when phase key matches and action is ESCALATE', () => {
    const symptom = {
      phase_override: {
        phase_3: { action: 'ESCALATE', note: 'Red flag at late phase' },
      },
    };
    expect(svc.checkPhaseOverride(symptom, 'phase_3')).toEqual({
      outcome: 'ESCALATE',
      reasoning: 'Red flag at late phase',
    });
  });

  it('returns ADVISE when phase key matches and action is ADVISE', () => {
    const symptom = {
      phase_override: {
        phase_2: { action: 'ADVISE', note: 'Monitor closely' },
      },
    };
    expect(svc.checkPhaseOverride(symptom, 'phase_2')).toEqual({
      outcome: 'ADVISE',
      reasoning: 'Monitor closely',
    });
  });

  it('is case-insensitive on phase key comparison', () => {
    const symptom = {
      phase_override: { Phase_1: { action: 'REASSURE', note: 'note' } },
    };
    expect(svc.checkPhaseOverride(symptom, 'phase_1')?.outcome).toBe('REASSURE');
  });

  it('returns null when no phase key matches', () => {
    const symptom = {
      phase_override: { phase_1: { action: 'REASSURE', note: 'Early phase only' } },
    };
    expect(svc.checkPhaseOverride(symptom, 'phase_3')).toBeNull();
  });

  it('still handles legacy string form', () => {
    const symptom = {
      phase_override: 'Phase I: REASSURE\nPhase III: ESCALATE',
    };
    expect(svc.checkPhaseOverride(symptom, 'Phase I')?.outcome).toBe('REASSURE');
  });

  it('returns null when phase_override is null', () => {
    expect(svc.checkPhaseOverride({ phase_override: null }, 'phase_1')).toBeNull();
  });
});
