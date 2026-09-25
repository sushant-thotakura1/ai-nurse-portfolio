import axios from 'axios';
import { WhatsAppAdapter } from '../../../src/messaging/adapters/whatsapp.adapter';

jest.mock('axios');

const TENANT_ID = 'tenant-1';
const MOCK_PRISMA = {};

const adapter = new WhatsAppAdapter(
  { phoneNumberId: '123', accessToken: 'fake-access-token', verifyToken: 'vt' },
  'app-secret',
);

function makeWebhookBody(message: object) {
  return {
    entry: [{ changes: [{ value: { messages: [message] } }] }],
  };
}

describe('WhatsAppAdapter.parseWebhook', () => {
  beforeEach(() => jest.resetAllMocks());

  describe('text message', () => {
    it('returns InboundMessage for a text message', async () => {
      const body = makeWebhookBody({
        from: '919999999999',
        type: 'text',
        text: { body: 'Hello nurse' },
        timestamp: '1711500000',
      });

      const result = await adapter.parseWebhook(body, TENANT_ID, MOCK_PRISMA);

      expect(result).not.toBeNull();
      expect(result!.text).toBe('Hello nurse');
      expect(result!.channel).toBe('whatsapp');
      expect(result!.senderId).toBe('+919999999999');
    });
  });

  describe('interactive message', () => {
    it('returns InboundMessage using button_reply id', async () => {
      const body = makeWebhookBody({
        from: '919999999999',
        type: 'interactive',
        interactive: { button_reply: { id: 'phase_1', title: 'Phase I' } },
        timestamp: '1711500000',
      });

      const result = await adapter.parseWebhook(body, TENANT_ID, MOCK_PRISMA);

      expect(result).not.toBeNull();
      expect(result!.text).toBe('phase_1');
    });

    it('returns null when interactive reply has no id', async () => {
      const body = makeWebhookBody({
        from: '919999999999',
        type: 'interactive',
        interactive: { button_reply: { id: '', title: '' } },
        timestamp: '1711500000',
      });

      const result = await adapter.parseWebhook(body, TENANT_ID, MOCK_PRISMA);
      expect(result).toBeNull();
    });
  });

  describe('audio message handling', () => {
    const audioBody = makeWebhookBody({
      from: '919999999999',
      type: 'audio',
      audio: { id: 'media-id-abc123' },
      timestamp: '1711500000',
    });

    beforeEach(() => {
      // Mock axios.get for two-step media download
      (axios.get as jest.Mock)
        .mockResolvedValueOnce({ data: { url: 'https://lookaside.fbsbytes.net/audio.ogg' } })
        .mockResolvedValueOnce({ data: Buffer.from('fake-audio-bytes') });
    });

    it('downloads media and returns transcript as InboundMessage', async () => {
      const result = await adapter.parseWebhook(audioBody, TENANT_ID, MOCK_PRISMA);

      expect(result).not.toBeNull();
      expect(result!.text).toBe('');
      expect(result!.inputType).toBe('audio');
      expect(result!.audioBuffer).toBeInstanceOf(Buffer);
      expect(result!.channel).toBe('whatsapp');
      expect(result!.senderId).toBe('+919999999999');
      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('media-id-abc123'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer fake-access-token' }),
        }),
      );
    });

    it('returns null when media download fails', async () => {
      (axios.get as jest.Mock).mockReset();
      (axios.get as jest.Mock).mockRejectedValue(new Error('Graph API 500'));

      const result = await adapter.parseWebhook(audioBody, TENANT_ID, MOCK_PRISMA);
      expect(result).toBeNull();
    });
  });

  describe('unsupported message type', () => {
    it('returns null for image messages', async () => {
      const body = makeWebhookBody({
        from: '919999999999',
        type: 'image',
        image: { id: 'img-123' },
        timestamp: '1711500000',
      });

      const result = await adapter.parseWebhook(body, TENANT_ID, MOCK_PRISMA);
      expect(result).toBeNull();
    });
  });
});
