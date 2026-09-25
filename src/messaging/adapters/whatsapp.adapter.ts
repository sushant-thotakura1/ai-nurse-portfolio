import crypto from 'crypto';
import axios from 'axios';
import { Request } from 'express';
import { MessagingProvider, InboundMessage, OutboundMessage, MessageContent } from '../interfaces';
import { logger } from '../../core/logger';
import { isWav, wavToMp3 } from '../../speech/wav-to-mp3';

interface WhatsAppCredentials {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
}

const GRAPH_API_URL = 'https://graph.facebook.com/v18.0';

export class WhatsAppAdapter implements MessagingProvider {
  constructor(
    private readonly credentials: WhatsAppCredentials,
    private readonly appSecret: string,
  ) {}

  // ── Webhook verification ─────────────────────────────────────────────────

  verifyWebhook(req: Request): boolean {
    try {
      // If no appSecret is configured, skip HMAC verification.
      // Meta only sends x-hub-signature-256 when an App Secret is set in the
      // Meta developer portal — without it, signature verification is impossible.
      if (!this.appSecret) {
        logger.warn('WhatsApp appSecret not configured — skipping signature verification');
        return true;
      }

      const sigHeader = req.headers['x-hub-signature-256'] as string | undefined;
      if (!sigHeader) return false;

      const rawBody: Buffer = (req as any).rawBody;
      if (!rawBody) return false;

      const expected = 'sha256=' + crypto
        .createHmac('sha256', this.appSecret)
        .update(rawBody)
        .digest('hex');

      return crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  // ── Parse inbound webhook payload ────────────────────────────────────────

  async parseWebhook(
    body: unknown,
    tenantId: string,
    prisma: any,
  ): Promise<InboundMessage | null> {
    try {
      const payload = body as any;
      const message = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!message) return null;

      const senderId = '+' + message.from.replace(/^\+/, ''); // ensure + prefix
      const timestamp = new Date(parseInt(message.timestamp, 10) * 1000);

      if (message.type === 'text') {
        return {
          channel: 'whatsapp',
          senderId,
          text: message.text.body,
          timestamp,
          rawPayload: body,
          contextMessageId: message.context?.id,
        };
      }

      if (message.type === 'interactive') {
        const reply = message.interactive?.list_reply ?? message.interactive?.button_reply;
        const text = reply?.id ?? '';
        if (!text) return null;
        return {
          channel: 'whatsapp',
          senderId,
          text,
          timestamp,
          rawPayload: body,
          contextMessageId: message.context?.id,
        };
      }

      if (message.type === 'audio') {
        try {
          const audioBuffer = await this.downloadMedia(message.audio.id);
          return {
            channel: 'whatsapp',
            senderId,
            text: '',
            timestamp,
            rawPayload: body,
            inputType: 'audio',
            audioBuffer,
          };
        } catch (err: any) {
          logger.error('WhatsApp audio download failed', {
            mediaId: message.audio?.id,
            error: err.message,
          });
          return null;
        }
      }

      return null; // media and other message types not supported
    } catch {
      return null;
    }
  }

  private async uploadMedia(audioBuffer: Buffer): Promise<string> {
    // Sarvam TTS returns WAV (PCM); WhatsApp only accepts MP3/AAC/OGG.
    // Convert WAV → MP3 before uploading so the audio plays on the recipient's device.
    let uploadBuffer = audioBuffer;
    if (isWav(audioBuffer)) {
      logger.info('WhatsApp uploadMedia: detected WAV, converting to MP3');
      uploadBuffer = wavToMp3(audioBuffer);
    }

    const url = `${GRAPH_API_URL}/${this.credentials.phoneNumberId}/media`;
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', 'audio/mpeg');
    form.append('file', uploadBuffer, { filename: 'reply.mp3', contentType: 'audio/mpeg' });
    const { data } = await axios.post(url, form, {
      headers: { Authorization: `Bearer ${this.credentials.accessToken}`, ...form.getHeaders() },
      timeout: 30_000,
    });
    return data.id as string;
  }

  private async downloadMedia(mediaId: string): Promise<Buffer> {
    // Step 1: resolve temporary download URL from Graph API
    const { data: meta } = await axios.get(
      `${GRAPH_API_URL}/${mediaId}`,
      { headers: { Authorization: `Bearer ${this.credentials.accessToken}` }, timeout: 10_000 },
    );
    // Step 2: download the raw audio bytes (WhatsApp voice notes are max 16 MB)
    const { data } = await axios.get(meta.url, {
      headers: { Authorization: `Bearer ${this.credentials.accessToken}` },
      responseType: 'arraybuffer',
      timeout: 30_000,
      maxContentLength: 20 * 1024 * 1024,
    });
    return Buffer.from(data);
  }

  // ── Send outbound message ────────────────────────────────────────────────

  async sendMessage(msg: OutboundMessage): Promise<string | null> {
    const recipientE164 = msg.recipientId.replace(/^\+/, ''); // WA expects no leading +
    let firstWamid: string | null = null;
    for (const content of msg.content) {
      const wamid = await this.sendContentWithRetry(recipientE164, content);
      if (firstWamid === null && wamid !== null) firstWamid = wamid;
    }
    return firstWamid;
  }

  private async sendContentWithRetry(to: string, content: MessageContent, attempt = 1): Promise<string | null> {
    const url = `${GRAPH_API_URL}/${this.credentials.phoneNumberId}/messages`;
    const headers = {
      Authorization: `Bearer ${this.credentials.accessToken}`,
      'Content-Type': 'application/json',
    };

    // Upload audio buffer first, then swap to media-id payload
    let resolvedContent = content;
    if (content.type === 'audio' && content.audioBuffer) {
      const mediaId = await this.uploadMedia(content.audioBuffer);
      resolvedContent = { type: 'audio', text: undefined, audioBuffer: undefined } as any;
      (resolvedContent as any)._mediaId = mediaId;
    }

    const data = this.buildPayload(to, resolvedContent);

    try {
      const response = await axios.post(url, data, { headers });
      return response.data?.messages?.[0]?.id ?? null;
    } catch (err: any) {
      const status = err?.response?.status;
      if (status >= 500 && attempt < 2) {
        logger.warn('WhatsApp API 5xx — retrying', { to, attempt });
        return this.sendContentWithRetry(to, content, attempt + 1);
      }
      logger.error('WhatsApp send failed', { to, status, error: err.message, detail: err?.response?.data });
      throw err;
    }
  }

  private buildPayload(to: string, content: MessageContent): object {
    const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };

    if (content.type === 'text') {
      return { ...base, type: 'text', text: { body: content.text } };
    }

    if (content.type === 'interactive' && content.interactive) {
      const ic = content.interactive;

      if (ic.type === 'list') {
        return {
          ...base,
          type: 'interactive',
          interactive: {
            type: 'list',
            body: { text: ic.body },
            action: {
              button: ic.listButtonLabel ?? 'Select',
              sections: ic.sections ?? [],
            },
          },
        };
      }

      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: ic.type,
          body: { text: ic.body },
          action: {
            buttons: (ic.buttons ?? []).map(b => ({
              type: 'reply',
              reply: { id: b.id, title: b.title },
            })),
          },
        },
      };
    }

    if (content.type === 'template' && content.template) {
      const t = content.template;
      return {
        ...base,
        type: 'template',
        template: {
          name: t.name,
          language: { code: t.languageCode },
          components: t.parameters.length > 0 ? [{
            type: 'body',
            parameters: t.parameters.map(p => ({ type: 'text', text: p })),
          }] : [],
        },
      };
    }

    if (content.type === 'audio') {
      const mediaId = (content as any)._mediaId;
      return { ...base, type: 'audio', audio: { id: mediaId } };
    }

    // Fallback — should never reach here with Zod-validated content
    return { ...base, type: 'text', text: { body: 'Message unavailable' } };
  }
}
