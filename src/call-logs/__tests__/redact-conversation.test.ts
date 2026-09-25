import { redactConversation } from '../redact-conversation';

describe('redactConversation', () => {
  it('redacts patient name and phone number', () => {
    const conversation = {
      id: 'session-1',
      callPurpose: 'WHATSAPP_CHAT',
      patient: {
        name: 'Jane Doe',
        phoneNumber: '+15551234567',
        condition: 'heart_failure',
        classification: 'HFrEF',
        conditionStartDate: '2026-01-01',
      },
      formattedTranscript: 'Nurse: How are you feeling?\nPatient: Better today.',
    };

    const result = redactConversation(conversation);

    expect(result.patient?.name).toBe('[REDACTED]');
    expect(result.patient?.phoneNumber).toBe('[REDACTED]');
    expect(result.patient?.condition).toBe('heart_failure');
    expect(result.patient?.classification).toBe('HFrEF');
    expect(result.formattedTranscript).toBe(conversation.formattedTranscript);
    expect(result.id).toBe('session-1');
  });

  it('leaves other top-level fields untouched', () => {
    const conversation = {
      id: 'session-2',
      assessments: [{ id: 'a1', outcome: 'ESCALATE' }],
      patientFacts: [{ id: 'f1', factId: 'weight', value: 82 }],
      patient: { name: 'John Smith', phoneNumber: '+15559876543' },
    };

    const result = redactConversation(conversation);

    expect(result.assessments).toEqual(conversation.assessments);
    expect(result.patientFacts).toEqual(conversation.patientFacts);
  });

  it('handles a conversation with no patient object', () => {
    const conversation = { id: 'session-3', formattedTranscript: null };

    const result = redactConversation(conversation);

    expect(result).toEqual(conversation);
  });

  it('does not mutate the input object', () => {
    const conversation = {
      id: 'session-4',
      patient: { name: 'Jane Doe', phoneNumber: '+15551234567' },
    };

    redactConversation(conversation);

    expect(conversation.patient?.name).toBe('Jane Doe');
  });
});
