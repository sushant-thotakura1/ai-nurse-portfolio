import { ChannelsService } from '../../../src/messaging/channels.service';

// Mock Prisma
const mockPrisma = {
  providerConfig: {
    upsert: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
};

// Mock axios for Telegram API calls
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock encryption
jest.mock('../../../src/core/encryption', () => ({
  encrypt: jest.fn((s: string) => `encrypted:${s}`),
  decrypt: jest.fn((s: string) => s.replace('encrypted:', '')),
}));

const TENANT_ID = 'tenant-123';
const TENANT_SLUG = 'tenant-test';
const BASE_URL = 'https://example.ngrok.io';

describe('ChannelsService', () => {
  let service: ChannelsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChannelsService(mockPrisma as any);
  });

  describe('saveAndActivate (telegram)', () => {
    it('registers webhook with Telegram then saves credentials', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({ data: { ok: true } });
      mockPrisma.providerConfig.upsert.mockResolvedValue({ updatedAt: new Date() });

      const result = await service.saveAndActivate('telegram', {
        botToken: 'bot123:TOKEN',
        secretToken: 'mysecret',
      }, TENANT_ID, BASE_URL, TENANT_SLUG);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.telegram.org/botbot123:TOKEN/setWebhook',
        expect.objectContaining({ url: expect.stringContaining('/webhooks/telegram'), secret_token: 'mysecret' })
      );
      expect(mockPrisma.providerConfig.upsert).toHaveBeenCalled();
      expect(result.status).toBe('active');

      // Verify Telegram API was called BEFORE DB write
      const telegramCallOrder = (mockedAxios.post as jest.Mock).mock.invocationCallOrder[0];
      const upsertCallOrder = mockPrisma.providerConfig.upsert.mock.invocationCallOrder[0];
      expect(telegramCallOrder).toBeLessThan(upsertCallOrder);
    });

    it('does NOT save credentials if Telegram webhook registration fails', async () => {
      mockedAxios.post = jest.fn().mockResolvedValue({ data: { ok: false, description: 'Bad Token' } });

      await expect(service.saveAndActivate('telegram', {
        botToken: 'bad',
        secretToken: 'sec',
      }, TENANT_ID, BASE_URL, TENANT_SLUG)).rejects.toThrow('Bad Token');

      expect(mockPrisma.providerConfig.upsert).not.toHaveBeenCalled();
    });
  });

  describe('saveAndActivate (whatsapp)', () => {
    it('saves credentials without calling any external API', async () => {
      mockPrisma.providerConfig.upsert.mockResolvedValue({ updatedAt: new Date() });

      const result = await service.saveAndActivate('whatsapp', {
        phoneNumberId: '12345',
        accessToken: 'EAAG...',
        verifyToken: 'myverify',
      }, TENANT_ID, BASE_URL, TENANT_SLUG);

      expect(mockedAxios.post).not.toHaveBeenCalled();
      expect(result.status).toBe('configured');
      expect(result.webhookUrl).toContain('/webhooks/whatsapp');
    });
  });

  describe('deactivate (telegram)', () => {
    it('sets isActive=false and calls deleteWebhook', async () => {
      mockPrisma.providerConfig.findFirst.mockResolvedValue({
        config: { encrypted: 'encrypted:{"botToken":"bot:TOKEN","secretToken":"sec"}' },
      });
      mockPrisma.providerConfig.update.mockResolvedValue({});
      mockedAxios.post = jest.fn().mockResolvedValue({ data: { ok: true } });

      const result = await service.deactivate('telegram', TENANT_ID);

      expect(mockPrisma.providerConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } })
      );
      expect(mockedAxios.post).toHaveBeenCalledWith(
        expect.stringContaining('deleteWebhook'), expect.anything()
      );
      expect(result.warning).toBeUndefined();
    });

    it('still deactivates even if deleteWebhook call fails', async () => {
      mockPrisma.providerConfig.findFirst.mockResolvedValue({
        config: { encrypted: 'encrypted:{"botToken":"bot:TOKEN","secretToken":"sec"}' },
      });
      mockPrisma.providerConfig.update.mockResolvedValue({});
      mockedAxios.post = jest.fn().mockRejectedValue(new Error('network error'));

      const result = await service.deactivate('telegram', TENANT_ID);

      expect(mockPrisma.providerConfig.update).toHaveBeenCalled();
      expect(result.warning).toBeDefined();
    });

    it('returns empty result when channel not found', async () => {
      mockPrisma.providerConfig.findFirst.mockResolvedValue(null);
      mockPrisma.providerConfig.update.mockResolvedValue({});

      const result = await service.deactivate('telegram', TENANT_ID);

      expect(mockPrisma.providerConfig.update).not.toHaveBeenCalled();
      expect(result.warning).toBeUndefined();
    });
  });

  describe('deactivate (whatsapp)', () => {
    it('sets isActive=false with no API call', async () => {
      mockPrisma.providerConfig.findFirst.mockResolvedValue({ id: 'row-1' });
      mockPrisma.providerConfig.update.mockResolvedValue({});

      await service.deactivate('whatsapp', TENANT_ID);

      expect(mockPrisma.providerConfig.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } })
      );
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('returns empty result when whatsapp channel not found', async () => {
      mockPrisma.providerConfig.findFirst.mockResolvedValue(null);

      const result = await service.deactivate('whatsapp', TENANT_ID);

      expect(mockPrisma.providerConfig.update).not.toHaveBeenCalled();
    });
  });

  describe('getChannels', () => {
    it('returns masked secrets and never raw values', async () => {
      mockPrisma.providerConfig.findMany.mockResolvedValue([{
        providerName: 'telegram',
        isActive: true,
        updatedAt: new Date('2026-03-28T22:30:00Z'),
        config: { encrypted: 'encrypted:{"botToken":"bot123:LONGTOKEN","secretToken":"abc123456789"}' },
      }]);

      const [channel] = await service.getChannels(TENANT_ID);

      expect(channel.channel).toBe('telegram');
      expect(channel.maskedSecrets.botToken).toMatch(/^•+/);
      expect(channel.maskedSecrets.botToken).toMatch(/GTOKEN$/);
      expect(channel.maskedSecrets.botToken).not.toContain('bot123');
    });

    it('returns isActive: false for deactivated channels (not excluded)', async () => {
      mockPrisma.providerConfig.findMany.mockResolvedValue([{
        providerName: 'telegram',
        isActive: false,
        updatedAt: new Date(),
        config: { encrypted: 'encrypted:{"botToken":"x","secretToken":"y"}' },
      }]);

      const [channel] = await service.getChannels(TENANT_ID);
      expect(channel.isActive).toBe(false);
    });
  });

  describe('getBaseUrl / saveBaseUrl', () => {
    it('returns empty string when no base URL is stored', async () => {
      mockPrisma.providerConfig.findFirst.mockResolvedValue(null);
      const url = await service.getBaseUrl(TENANT_ID);
      expect(url).toBe('');
    });

    it('saves base URL as ProviderConfig system row', async () => {
      mockPrisma.providerConfig.upsert.mockResolvedValue({});
      await service.saveBaseUrl('https://example.com', TENANT_ID);
      expect(mockPrisma.providerConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId_providerName: { tenantId: TENANT_ID, providerName: 'base-url' } },
        })
      );
    });
  });
});
