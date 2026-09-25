jest.mock('../core/database', () => ({
  prisma: {
    messageSession: { findFirst: jest.fn() },
    callSession:    { findFirst: jest.fn() },
    transcript:     { findMany: jest.fn() },
    patient:        { findFirst: jest.fn() },
  },
}));

jest.mock('../core/logger', () => ({
  logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

jest.mock('../core/encryption', () => ({
  decrypt: jest.fn((v: string) => `decrypted:${v}`),
}));

import { prisma } from '../core/database';
import { ConversationsService } from './service';

const mockMsgSession  = prisma.messageSession.findFirst as jest.Mock;
const mockCallSession = prisma.callSession.findFirst   as jest.Mock;
const mockTranscript  = prisma.transcript.findMany     as jest.Mock;
const mockPatient     = prisma.patient.findFirst       as jest.Mock;

const makePatient = (overrides: Record<string, any> = {}) => ({
  id: 'patient-1',
  encryptedName: 'enc-Sushant',
  phoneNumber: '+919381134397',
  condition: 'Keratoplasty',
  classification: 'PKP',
  conditionStartDate: new Date('2026-07-16T00:00:00Z'),
  ...overrides,
});

describe('ConversationsService.getTranscript', () => {
  let service: ConversationsService;

  beforeEach(() => {
    service = new ConversationsService();
    jest.clearAllMocks();
  });

  it('returns messaging transcript with patient details and linked call session fields', async () => {
    mockMsgSession.mockResolvedValue({
      id: 'sess-1',
      tenantId: 'tenant-1',
      patientId: 'patient-1',
      channel: 'whatsapp',
      createdAt: new Date('2026-07-21T10:00:00Z'),
      transcript: [
        { speaker: 'agent',   originalText: 'Hello',    timestamp: '2026-07-21T10:00:00Z' },
        { speaker: 'patient', originalText: 'Hi there', timestamp: '2026-07-21T10:01:00Z' },
      ],
    });
    mockPatient.mockResolvedValue(makePatient());
    mockCallSession.mockResolvedValue({
      outcome: 'ESCALATE',
      feedbackText: 'Wrong classification',
      endedAt: new Date('2026-07-21T10:05:00Z'),
    });

    const result = await service.getTranscript('tenant-1', 'sess-1');

    expect(result.sessionType).toBe('messaging');
    expect(result.channel).toBe('whatsapp');
    expect(result.formattedTranscript).toContain('Nurse: Hello');
    expect(result.formattedTranscript).toContain('Patient: Hi there');

    expect(result.patient.name).toBe('decrypted:enc-Sushant');
    expect(result.patient.phoneNumber).toBe('+919381134397');
    expect(result.patient.condition).toBe('Keratoplasty');
    expect(result.patient.classification).toBe('PKP');
    expect(result.patient.conditionStartDate).toEqual(new Date('2026-07-16T00:00:00Z'));

    expect(result.outcome).toBe('ESCALATE');
    expect(result.feedbackText).toBe('Wrong classification');
    expect(result.endedAt).toEqual(new Date('2026-07-21T10:05:00Z'));

    // callSession queried for linked session, not as the primary lookup
    expect(mockCallSession).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ messageSessionId: 'sess-1' }) })
    );
  });

  it('returns null outcome/feedback when no linked CallSession exists for a messaging session', async () => {
    mockMsgSession.mockResolvedValue({
      id: 'sess-1b',
      tenantId: 'tenant-1',
      patientId: 'patient-1',
      channel: 'whatsapp',
      createdAt: new Date('2026-07-21T10:00:00Z'),
      transcript: [],
    });
    mockPatient.mockResolvedValue(makePatient());
    mockCallSession.mockResolvedValue(null);

    const result = await service.getTranscript('tenant-1', 'sess-1b');

    expect(result.outcome).toBeNull();
    expect(result.feedbackText).toBeNull();
    expect(result.endedAt).toBeNull();
  });

  it('falls back to deleted-messageSession path when MessageSession was deleted but CallSession has messageSessionId', async () => {
    // Simulates the common case: findOrResetSession deleted the MessageSession row
    // after the patient started a new conversation. The callSession still exists
    // with messageSessionId pointing at the (now-gone) row.
    mockMsgSession.mockResolvedValue(null);
    const closedCallSession = {
      id: 'cs-whatsapp-1',
      tenantId: 'tenant-1',
      patientId: 'patient-2',
      callPurpose: 'WHATSAPP_CHAT',
      startedAt: new Date('2026-07-21T09:00:00Z'),
      endedAt: new Date('2026-07-21T09:10:00Z'),
      outcome: 'REASSURE',
      feedbackText: 'All good',
      patient: makePatient({ id: 'patient-2' }),
    };
    // First callSession.findFirst call: by messageSessionId (fallback lookup) → found
    mockCallSession.mockResolvedValueOnce(closedCallSession);
    mockTranscript.mockResolvedValue([
      { speaker: 'agent',   originalText: 'Good morning', timestamp: new Date(), turnNumber: 1 },
      { speaker: 'patient', originalText: 'Morning',      timestamp: new Date(), turnNumber: 2 },
    ]);

    const result = await service.getTranscript('tenant-1', 'deleted-msg-sess-id');

    expect(result.sessionType).toBe('messaging');
    expect(result.channel).toBe('WHATSAPP_CHAT');
    expect(result.formattedTranscript).toContain('Nurse: Good morning');
    expect(result.formattedTranscript).toContain('Patient: Morning');
    expect(result.outcome).toBe('REASSURE');
    expect(result.feedbackText).toBe('All good');
    expect(result.endedAt).toEqual(new Date('2026-07-21T09:10:00Z'));
    // Transcript rows looked up by callSession.id, not the original messageSessionId
    expect(mockTranscript).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sessionId: 'cs-whatsapp-1' } })
    );
  });

  it('falls back to voice transcript with patient details when only CallSession is found by id', async () => {
    mockMsgSession.mockResolvedValue(null);
    // First callSession.findFirst call: by messageSessionId → null (not a WhatsApp session)
    // Second callSession.findFirst call: by id → the voice session
    mockCallSession
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'sess-2',
        tenantId: 'tenant-1',
        patientId: 'patient-2',
        startedAt: new Date('2026-07-21T09:00:00Z'),
        endedAt: new Date('2026-07-21T09:10:00Z'),
        outcome: 'REASSURE',
        feedbackText: null,
        patient: makePatient({ id: 'patient-2', condition: 'Cataract', classification: null }),
      });
    mockTranscript.mockResolvedValue([
      { speaker: 'agent',   originalText: 'Good morning', timestamp: new Date(), turnNumber: 1 },
      { speaker: 'patient', originalText: 'Morning',      timestamp: new Date(), turnNumber: 2 },
    ]);

    const result = await service.getTranscript('tenant-1', 'sess-2');

    expect(result.sessionType).toBe('voice');
    expect(result.channel).toBe('voice');
    expect(result.formattedTranscript).toContain('Nurse: Good morning');
    expect(result.patient.condition).toBe('Cataract');
    expect(result.patient.classification).toBeNull();
    expect(result.outcome).toBe('REASSURE');
    expect(result.endedAt).toEqual(new Date('2026-07-21T09:10:00Z'));
  });

  it('throws "Session not found" when neither session exists', async () => {
    mockMsgSession.mockResolvedValue(null);
    // Both fallback lookups (by messageSessionId, then by id) return null
    mockCallSession.mockResolvedValue(null);

    await expect(service.getTranscript('tenant-1', 'no-such-id'))
      .rejects.toThrow('Session not found');
  });

  it('maps agent speaker to "Nurse:" and patient speaker to "Patient:"', async () => {
    mockMsgSession.mockResolvedValue({
      id: 'sess-3',
      tenantId: 'tenant-1',
      patientId: 'patient-3',
      channel: 'telegram',
      createdAt: new Date('2026-07-21T11:00:00Z'),
      transcript: [
        { speaker: 'agent',   originalText: 'Are you okay?', timestamp: '2026-07-21T11:00:00Z' },
        { speaker: 'patient', originalText: 'Yes I am',      timestamp: '2026-07-21T11:01:00Z' },
      ],
    });
    mockPatient.mockResolvedValue(makePatient({ id: 'patient-3' }));
    mockCallSession.mockResolvedValue(null);

    const result = await service.getTranscript('tenant-1', 'sess-3');
    const lines = result.formattedTranscript.split('\n').filter((l: string) => l.trim());

    expect(lines[1]).toBe('Nurse: Are you okay?');
    expect(lines[2]).toBe('Patient: Yes I am');
  });

  it('returns empty name gracefully when decryption fails', async () => {
    const { decrypt } = require('../core/encryption');
    (decrypt as jest.Mock).mockImplementationOnce(() => { throw new Error('decrypt failed'); });

    mockMsgSession.mockResolvedValue({
      id: 'sess-4',
      tenantId: 'tenant-1',
      patientId: 'patient-4',
      channel: 'whatsapp',
      createdAt: new Date('2026-07-21T10:00:00Z'),
      transcript: [],
    });
    mockPatient.mockResolvedValue(makePatient({ id: 'patient-4', encryptedName: 'bad-enc' }));
    mockCallSession.mockResolvedValue(null);

    const result = await service.getTranscript('tenant-1', 'sess-4');
    expect(result.patient.name).toBe('');
  });
});
