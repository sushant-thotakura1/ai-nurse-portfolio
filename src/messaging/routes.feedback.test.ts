jest.mock('../core/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('./messaging-orchestrator', () => ({
  MessagingOrchestrator: jest.fn().mockImplementation(() => ({
    handleInbound: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../core/database', () => ({
  prisma:       {},
  systemPrisma: {},
}));

jest.mock('../core/encryption', () => ({
  decrypt: jest.fn().mockReturnValue('{}'),
}));

jest.mock('../core/config', () => ({
  config: { providers: { openai: { apiKey: 'test-key' } } },
}));

jest.mock('../ai-agent/adapters/openai.adapter', () => ({
  OpenAIAdapter: jest.fn(),
}));

jest.mock('./adapters/whatsapp.adapter', () => ({
  WhatsAppAdapter: jest.fn(),
}));

jest.mock('./adapters/telegram.adapter', () => ({
  TelegramAdapter: jest.fn(),
}));

import { tryHandleFeedback } from './routes';

describe('tryHandleFeedback', () => {
  let mockPrisma: any;
  let mockAdapter: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma = {
      callSession: {
        findFirst: jest.fn(),
        update:    jest.fn().mockResolvedValue({}),
      },
    };
    mockAdapter = {
      sendMessage: jest.fn().mockResolvedValue('wamid.thankyou'),
    };
  });

  it('stores feedback and sends thank-you when summaryWamid matches and feedbackText is null', async () => {
    mockPrisma.callSession.findFirst.mockResolvedValue({
      id: 'session-abc',
      feedbackText: null,
    });

    const handled = await tryHandleFeedback(
      'wamid.QUOTED_MSG_ID',
      'Great session!',
      '+919876543210',
      'tenant-1',
      mockAdapter,
      mockPrisma,
    );

    expect(handled).toBe(true);
    expect(mockPrisma.callSession.findFirst).toHaveBeenCalledWith({
      where: { summaryWamid: 'wamid.QUOTED_MSG_ID', tenantId: 'tenant-1' },
    });
    expect(mockPrisma.callSession.update).toHaveBeenCalledWith({
      where: { id: 'session-abc' },
      data:  { feedbackText: 'Great session!' },
    });
    expect(mockAdapter.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: '+919876543210',
        content: [{ type: 'text', text: 'Thank you for your feedback!' }],
      }),
    );
  });

  it('returns false when contextMessageId does not match any CallSession.summaryWamid', async () => {
    mockPrisma.callSession.findFirst.mockResolvedValue(null);

    const handled = await tryHandleFeedback(
      'wamid.UNKNOWN',
      'some text',
      '+919876543210',
      'tenant-1',
      mockAdapter,
      mockPrisma,
    );

    expect(handled).toBe(false);
    expect(mockPrisma.callSession.findFirst).toHaveBeenCalledWith({
      where: { summaryWamid: 'wamid.UNKNOWN', tenantId: 'tenant-1' },
    });
    expect(mockPrisma.callSession.update).not.toHaveBeenCalled();
    expect(mockAdapter.sendMessage).not.toHaveBeenCalled();
  });

  it('silently returns true when feedbackText is already set (idempotent — first reply wins)', async () => {
    mockPrisma.callSession.findFirst.mockResolvedValue({
      id: 'session-abc',
      feedbackText: 'existing feedback',
    });

    const handled = await tryHandleFeedback(
      'wamid.QUOTED_MSG_ID',
      'second reply',
      '+919876543210',
      'tenant-1',
      mockAdapter,
      mockPrisma,
    );

    expect(handled).toBe(true);
    expect(mockPrisma.callSession.update).not.toHaveBeenCalled();
    expect(mockAdapter.sendMessage).not.toHaveBeenCalled();
  });
});
