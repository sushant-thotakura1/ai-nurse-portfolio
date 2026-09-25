// tests/unit/messaging/telegram-adapter.test.ts
import { Request } from 'express';
import { TelegramAdapter } from '../../../src/messaging/adapters/telegram.adapter';

jest.mock('axios');
import axios from 'axios';

const FAKE_CREDENTIALS = {
  botToken: 'bot123:FAKE_TOKEN',
  secretToken: 'my-webhook-secret',
};

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter;

  beforeEach(() => {
    adapter = new TelegramAdapter(FAKE_CREDENTIALS);
    jest.clearAllMocks();
  });

  // ── verifyWebhook ─────────────────────────────────────────────────────────

  describe('verifyWebhook', () => {
    it('returns true for a matching secret token', () => {
      const req = {
        headers: { 'x-telegram-bot-api-secret-token': 'my-webhook-secret' },
      } as any as Request;
      expect(adapter.verifyWebhook(req)).toBe(true);
    });

    it('returns false for a wrong secret token', () => {
      const req = {
        headers: { 'x-telegram-bot-api-secret-token': 'wrong-secret' },
      } as any as Request;
      expect(adapter.verifyWebhook(req)).toBe(false);
    });

    it('returns false when the header is missing', () => {
      const req = { headers: {} } as any as Request;
      expect(adapter.verifyWebhook(req)).toBe(false);
    });
  });

  // ── parseWebhook ──────────────────────────────────────────────────────────

  describe('parseWebhook', () => {
    it('parses a valid text message', async () => {
      const body = {
        update_id: 12345,
        message: {
          message_id: 1,
          chat: { id: 987654321 },
          text: 'Hello',
          date: 1711500000,
        },
      };
      const result = await adapter.parseWebhook(body, 'tenant-test', {} as any);
      expect(result).not.toBeNull();
      expect(result!.channel).toBe('telegram');
      expect(result!.senderId).toBe('987654321');
      expect(result!.text).toBe('Hello');
    });

    it('returns null when message has no text (sticker, photo, etc.)', async () => {
      const body = { update_id: 1, message: { chat: { id: 1 }, sticker: {} } };
      expect(await adapter.parseWebhook(body, 'tenant-test', {} as any)).toBeNull();
    });

    it('returns null for malformed payload', async () => {
      expect(await adapter.parseWebhook({}, 'tenant-test', {} as any)).toBeNull();
      expect(await adapter.parseWebhook(null, 'tenant-test', {} as any)).toBeNull();
    });
  });

  // ── sendMessage ───────────────────────────────────────────────────────────

  describe('sendMessage', () => {
    it('POSTs a text message to sendMessage', async () => {
      (axios.post as jest.Mock).mockResolvedValue({ data: { ok: true } });

      await adapter.sendMessage({
        channel: 'telegram',
        recipientId: '987654321',
        content: [{ type: 'text', text: 'Hi there' }],
      });

      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({ chat_id: '987654321', text: 'Hi there' }),
      );
    });

    it('sends inline keyboard for interactive buttons', async () => {
      (axios.post as jest.Mock).mockResolvedValue({ data: { ok: true } });

      await adapter.sendMessage({
        channel: 'telegram',
        recipientId: '987654321',
        content: [{
          type: 'interactive',
          interactive: {
            type: 'button',
            body: 'Choose language',
            buttons: [{ id: 'hi', title: 'Hindi' }],
          },
        }],
      });

      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/sendMessage'),
        expect.objectContaining({ reply_markup: expect.any(Object) }),
      );
    });
  });
});
