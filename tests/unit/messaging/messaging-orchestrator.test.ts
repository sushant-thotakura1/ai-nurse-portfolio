// tests/unit/messaging/messaging-orchestrator.test.ts
import { MessagingOrchestrator } from '../../../src/messaging/messaging-orchestrator';
import { MessageState } from '../../../src/messaging/session';
import { InboundMessage } from '../../../src/messaging/interfaces';

jest.mock('../../../src/messaging/session');
jest.mock('../../../src/messaging/message-formatter');
jest.mock('../../../src/core/normalize-phone');
jest.mock('../../../src/knowledge-graph/context-loader', () => ({
  contextLoader: {
    loadContext: jest.fn().mockResolvedValue(null),
  },
}));

import { findOrResetSession } from '../../../src/messaging/session';
import { formatForChannel } from '../../../src/messaging/message-formatter';
import { normalizeToE164 } from '../../../src/core/normalize-phone';

const mockSession = {
  id: 'session-1',
  state: MessageState.INITIATED,
  patientId: '',
  locale: null,
  transcript: [],
  clinicalEvents: [],
};

const mockPatient = { id: 'patient-1', preferredLocale: 'hi-IN' };

const mockAdapter = {
  parseWebhook: jest.fn(),
  sendMessage: jest.fn().mockResolvedValue(undefined),
  verifyWebhook: jest.fn().mockReturnValue(true),
};

const mockLLM = {
  complete: jest.fn().mockResolvedValue({ content: 'Agent response', finishReason: 'stop', usage: {} }),
  stream: jest.fn(),
};

const mockPrisma = {
  messageSession: {
    update: jest.fn().mockResolvedValue({ ...mockSession, patientId: 'patient-1' }),
  },
  patient: {
    findFirst: jest.fn(),
  },
} as any;

const inbound: InboundMessage = {
  channel: 'whatsapp',
  senderId: '+919876543210',
  text: 'Hello',
  timestamp: new Date(),
  rawPayload: {},
};

describe('MessagingOrchestrator', () => {
  let orchestrator: MessagingOrchestrator;

  beforeEach(() => {
    jest.clearAllMocks();
    (findOrResetSession as jest.Mock).mockResolvedValue(mockSession);
    (normalizeToE164 as jest.Mock).mockReturnValue('+919876543210');
    (formatForChannel as jest.Mock).mockResolvedValue([{ type: 'text', text: 'Response' }]);
    orchestrator = new MessagingOrchestrator(mockAdapter as any, mockLLM as any, mockPrisma);
  });

  it('sends "not registered" message and stops when patient is not found', async () => {
    mockPrisma.patient.findFirst.mockResolvedValue(null);

    await orchestrator.handleInbound(inbound, 'tenant-1');

    expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'text', text: expect.stringContaining('not registered') }),
        ]),
      })
    );
    expect(mockPrisma.messageSession.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: expect.any(String) }) })
    );
  });

  it('writes patientId to session after successful patient lookup', async () => {
    mockPrisma.patient.findFirst.mockResolvedValue(mockPatient);

    await orchestrator.handleInbound(inbound, 'tenant-1');

    expect(mockPrisma.messageSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ patientId: 'patient-1' }) })
    );
  });

  it('calls the formatter and adapter after LLM generates a response', async () => {
    mockPrisma.patient.findFirst.mockResolvedValue(mockPatient);

    await orchestrator.handleInbound(inbound, 'tenant-1');

    expect(formatForChannel).toHaveBeenCalled();
    expect(mockAdapter.sendMessage).toHaveBeenCalled();
  });
});

describe('skill interception', () => {
  let orchestrator: MessagingOrchestrator;

  const mockSessionWithSkill = {
    id: 'session-1',
    state: 'CONVERSATION',
    locale: 'hi-IN',
    patientId: 'patient-1',
    flowState: { flow: 'set_health_condition', step: 'awaiting_condition' },
    transcript: [],
  };

  const mockPatientFull = {
    id: 'patient-1',
    phoneNumber: '+919999999999',
    preferredLocale: 'hi-IN',
    consentStatus: 'GRANTED',
    condition: null,
    conditionStartDate: null,
    knowledgeGraphId: null,
    knowledgeGraph: null,
  };

  const mockAdapterSkill = {
    sendMessage: jest.fn().mockResolvedValue(undefined),
    parseWebhook: jest.fn(),
    verifyWebhook: jest.fn(),
    buildPayload: jest.fn(),
  };

  const mockLLMSkill = {
    complete: jest.fn().mockResolvedValue({ content: 'Hello from AI' }),
  };

  const mockPrismaSkill = {
    patient: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    messageSession: {
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const inboundSkill: InboundMessage = {
    channel: 'whatsapp',
    senderId: '+919999999999',
    text: 'hello',
    timestamp: new Date(),
    rawPayload: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (normalizeToE164 as jest.Mock).mockReturnValue('+919999999999');
    orchestrator = new MessagingOrchestrator(mockAdapterSkill as any, mockLLMSkill as any, mockPrismaSkill as any);
  });

  it('invokes skill registry and returns early when a skill handles the message', async () => {
    (findOrResetSession as jest.Mock).mockResolvedValue(mockSessionWithSkill);
    mockPrismaSkill.patient.findFirst.mockResolvedValue(mockPatientFull);

    // Spy on the registry's handle method
    const skillHandleSpy = jest.spyOn((orchestrator as any).botFlowRegistry, 'handle')
      .mockResolvedValue(undefined);
    jest.spyOn((orchestrator as any).botFlowRegistry, 'shouldHandle')
      .mockReturnValue(true);

    await orchestrator.handleInbound(inboundSkill, 'tenant-1');

    expect(skillHandleSpy).toHaveBeenCalled();
    // LLM should NOT be called — skill short-circuited the flow
    expect(mockLLMSkill.complete).not.toHaveBeenCalled();
  });

  it('proceeds with normal state machine when no skill matches', async () => {
    (findOrResetSession as jest.Mock).mockResolvedValue({
      id: 'session-1',
      state: MessageState.INITIATED,
      patientId: 'patient-1',
      locale: 'hi-IN',
      flowState: null,
      transcript: [],
    });
    mockPrismaSkill.patient.findFirst.mockResolvedValue(mockPatientFull);
    (formatForChannel as jest.Mock).mockResolvedValue([{ type: 'text', text: 'response' }]);

    jest.spyOn((orchestrator as any).botFlowRegistry, 'shouldHandle')
      .mockReturnValue(false);

    await orchestrator.handleInbound(inboundSkill, 'tenant-1');

    expect(mockLLMSkill.complete).toHaveBeenCalled();
  });
});
