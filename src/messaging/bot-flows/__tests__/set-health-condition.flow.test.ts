import { SetHealthConditionFlow } from '../set-health-condition.flow';

describe('SetHealthConditionFlow — flush on scenario switch', () => {
  let flow: SetHealthConditionFlow;
  let mockPrisma: any;
  let mockAdapter: any;
  let mockLlm: any;

  const basePatient = (overrides: Record<string, unknown> = {}) => ({
    id: 'patient-1',
    tenantId: 'tenant-1',
    encryptedName: null,
    preferredLocale: 'en-IN',
    condition: 'Heart Failure',
    classification: 'HFrEF',
    isTestIdentity: true,
    ...overrides,
  });

  const baseSession = (phases: Array<{ id: string; label: string; daysStart: number; daysEnd: number | null }>) => ({
    id: 'session-1',
    channel: 'whatsapp',
    senderId: 'sender-1',
    locale: 'en-IN',
    transcript: [],
    flowState: {
      flow: 'set_health_condition',
      step: 'awaiting_phase',
      conditionName: 'Heart Failure',
      selectedClassification: 'HFrEF',
      triggerType: 'discharge_date',
      kgId: 'kg-1',
      phases,
    },
  });

  beforeEach(() => {
    flow = new SetHealthConditionFlow();
    mockPrisma = {
      patient: { update: jest.fn().mockResolvedValue({}) },
      messageSession: { update: jest.fn().mockResolvedValue({}) },
      patientFact: { updateMany: jest.fn().mockResolvedValue({}), deleteMany: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn((cb: any) => cb(mockPrisma)),
    };
    mockAdapter = { sendMessage: jest.fn().mockResolvedValue(undefined) };
    mockLlm = {};
  });

  const phases = [{ id: 'phase_1', label: 'Phase I', daysStart: 0, daysEnd: 7 }];

  it('flushes facts when a test identity switches condition', async () => {
    const patient = basePatient({ condition: 'Cardiac Surgery' }); // different from flowState.conditionName
    const session = baseSession(phases);

    await flow.handle(session, 'phase_1', patient, 'tenant-1', mockPrisma, mockAdapter, mockLlm);

    // Both tenantId AND patientId must be present -- patientId alone is not
    // a safe tenant-isolation boundary. This assertion would fail if the
    // implementation dropped tenantId from the where clause.
    expect(mockPrisma.patientFact.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-1', patientId: 'patient-1' } }),
    );
  });

  it('flushes and reassigns atomically: one transaction, updateMany before deleteMany before patient.update', async () => {
    const patient = basePatient({ condition: 'Cardiac Surgery' }); // different from flowState.conditionName
    const session = baseSession(phases);

    await flow.handle(session, 'phase_1', patient, 'tenant-1', mockPrisma, mockAdapter, mockLlm);

    // Flush + reassignment must happen inside exactly one $transaction call
    // -- not two separate transactions/writes that could leave a crash
    // window between "facts deleted" and "condition still old".
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

    expect(mockPrisma.patientFact.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', patientId: 'patient-1' },
      data: { supersedesId: null },
    });
    expect(mockPrisma.patientFact.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', patientId: 'patient-1' },
    });

    // Order matters: updateMany must run before deleteMany (breaks the
    // supersedesId self-reference before the row can be deleted), and both
    // must run before patient.update reassigns the condition -- so a crash
    // mid-transaction never leaves facts flushed but the old condition
    // still recorded.
    const updateManyOrder = (mockPrisma.patientFact.updateMany as jest.Mock).mock.invocationCallOrder[0];
    const deleteManyOrder = (mockPrisma.patientFact.deleteMany as jest.Mock).mock.invocationCallOrder[0];
    const patientUpdateOrder = (mockPrisma.patient.update as jest.Mock).mock.invocationCallOrder[0];
    expect(updateManyOrder).toBeLessThan(deleteManyOrder);
    expect(deleteManyOrder).toBeLessThan(patientUpdateOrder);
  });

  it('flushes facts when a test identity switches classification only', async () => {
    const patient = basePatient({ classification: 'HFpEF' }); // different from flowState.selectedClassification
    const session = baseSession(phases);

    await flow.handle(session, 'phase_1', patient, 'tenant-1', mockPrisma, mockAdapter, mockLlm);

    expect(mockPrisma.patientFact.deleteMany).toHaveBeenCalled();
  });

  it('does NOT flush when only the phase changes (same condition, same classification)', async () => {
    const patient = basePatient(); // condition/classification match flowState exactly
    const session = baseSession(phases);

    await flow.handle(session, 'phase_1', patient, 'tenant-1', mockPrisma, mockAdapter, mockLlm);

    expect(mockPrisma.patientFact.deleteMany).not.toHaveBeenCalled();
  });

  it('does NOT flush a non-test identity, even when condition changes', async () => {
    const patient = basePatient({ condition: 'Cardiac Surgery', isTestIdentity: false });
    const session = baseSession(phases);

    await flow.handle(session, 'phase_1', patient, 'tenant-1', mockPrisma, mockAdapter, mockLlm);

    expect(mockPrisma.patientFact.deleteMany).not.toHaveBeenCalled();
  });
});
