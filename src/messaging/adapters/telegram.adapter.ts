import axios from 'axios';
import { Request } from 'express';
import { MessagingProvider, InboundMessage, OutboundMessage, MessageContent } from '../interfaces';
import { logger } from '../../core/logger';

interface TelegramCredentials {
  botToken: string;
  secretToken: string;
}

export class TelegramAdapter implements MessagingProvider {
  private readonly apiBase: string;

  constructor(private readonly credentials: TelegramCredentials) {
    this.apiBase = `https://api.telegram.org/bot${credentials.botToken}`;
  }

  // ── Webhook verification ─────────────────────────────────────────────────

  verifyWebhook(req: Request): boolean {
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (!header) return false;
    return header === this.credentials.secretToken;
  }

  // ── Parse inbound webhook payload ────────────────────────────────────────

  async parseWebhook(
    body: unknown,
    _tenantId: string,
    _prisma: any,
  ): Promise<InboundMessage | null> {
    try {
      const payload = body as any;
      const message = payload?.message;
      if (!message || !message.text) return null;

      return {
        channel: 'telegram',
        senderId: String(message.chat.id),
        text: message.text,
        timestamp: new Date(message.date * 1000),
        rawPayload: body,
      };
    } catch {
      return null;
    }
  }

  // ── Send outbound message ────────────────────────────────────────────────

  async sendMessage(msg: OutboundMessage): Promise<string | null> {
    for (const content of msg.content) {
      await this.sendContent(msg.recipientId, content);
    }
    return null;
  }

  private async sendContent(chatId: string, content: MessageContent, attempt = 1): Promise<void> {
    const url = `${this.apiBase}/sendMessage`;

    let body: object;

    if (content.type === 'text') {
      body = { chat_id: chatId, text: content.text };
    } else if (content.type === 'interactive' && content.interactive) {
      const ic = content.interactive;
      body = {
        chat_id: chatId,
        text: ic.body,
        reply_markup: {
          inline_keyboard: [
            (ic.buttons ?? []).map(b => ({ text: b.title, callback_data: b.id })),
          ],
        },
      };
    } else if (content.type === 'template' && content.template) {
      // Telegram has no native template concept — send as plain text
      body = { chat_id: chatId, text: `[${content.template.name}] ${content.template.parameters.join(', ')}` };
    } else {
      return;
    }

    try {
      await axios.post(url, body);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status >= 500 && attempt < 2) {
        logger.warn('Telegram API 5xx — retrying', { chatId, attempt });
        return this.sendContent(chatId, content, attempt + 1);
      }
      logger.error('Telegram send failed', { chatId, status, error: err.message });
      throw err;
    }
  }
}

// NOTE — Out of scope for this phase:
// Telegram patient linking via "/start <token>" flow (see spec Section 9, Telegram testing only).
// When implementing, the orchestrator should detect the /start command, validate the token,
// look up the patient, and write patientId to the MessageSession record.
