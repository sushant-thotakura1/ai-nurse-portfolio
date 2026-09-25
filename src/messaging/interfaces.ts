import { Request } from 'express';

export type MessageChannel = 'whatsapp' | 'telegram';

export interface InboundMessage {
  channel: MessageChannel;
  senderId: string;      // E.164 phone (WhatsApp) or chat_id string (Telegram)
  text: string;
  timestamp: Date;
  rawPayload: unknown;   // original webhook body, kept for debugging
  inputType?: 'audio' | 'text';  // set to 'audio' when message came from a voice note
  audioBuffer?: Buffer;  // raw audio bytes; set when inputType === 'audio'
  contextMessageId?: string;  // wamid of the quoted message — set on WhatsApp swipe-to-reply
}

export interface ButtonOption {
  id: string;
  title: string;         // max 20 chars for WhatsApp
}

export interface InteractiveContent {
  type: 'button' | 'list';
  body: string;
  // button type — max 3 for WhatsApp
  buttons?: ButtonOption[];
  // list type — max 10 rows total across all sections
  listButtonLabel?: string;   // call-to-action label; adapter defaults to "Select" if omitted
  sections?: Array<{
    title: string;
    rows: Array<{ id: string; title: string }>;
  }>;
}

export interface TemplateContent {
  name: string;          // approved template name
  languageCode: string;  // e.g. 'en', 'hi'
  parameters: string[];  // ordered values for template placeholders
}

export interface MessageContent {
  type: 'text' | 'interactive' | 'template' | 'audio';
  text?: string;
  interactive?: InteractiveContent;
  template?: TemplateContent;
  audioBuffer?: Buffer;  // raw MP3 bytes for audio voice note replies
}

export interface OutboundMessage {
  channel: MessageChannel;
  recipientId: string;
  content: MessageContent[]; // array supports multi-part responses
}

export interface MessagingProvider {
  parseWebhook(body: unknown, tenantId: string, prisma: any): Promise<InboundMessage | null>;
  sendMessage(msg: OutboundMessage): Promise<string | null>;
  verifyWebhook(req: Request): boolean;
}
