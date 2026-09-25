jest.mock('axios');
jest.mock('../../core/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import axios from 'axios';
import { WhatsAppAdapter } from './whatsapp.adapter';

const mockAxiosPost = axios.post as jest.Mock;

const CREDS = { phoneNumberId: '123', accessToken: 'tok', verifyToken: 'vtok' };

function makeAdapter() {
  return new WhatsAppAdapter(CREDS, '');
}

describe('WhatsAppAdapter.parseWebhook', () => {
  const adapter = makeAdapter();

  it('sets contextMessageId from message.context.id on a quote-reply', async () => {
    const body = {
      entry: [{
        changes: [{
          value: {
            messages: [{
              from: '919876543210',
              timestamp: '1700000000',
              type: 'text',
              text: { body: 'great session!' },
              context: { id: 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhgM' },
            }],
          },
        }],
      }],
    };

    const result = await adapter.parseWebhook(body, 'tenant-1', {});

    expect(result).not.toBeNull();
    expect(result!.contextMessageId).toBe('wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhgM');
    expect(result!.text).toBe('great session!');
  });

  it('sets contextMessageId on an interactive swipe-reply', async () => {
    const body = {
      entry: [{ changes: [{ value: { messages: [{
        from: '919876543210', timestamp: '1700000000',
        type: 'interactive',
        interactive: { button_reply: { id: 'OPTION_YES' } },
        context: { id: 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhgM' },
      }] } }] }],
    };
    const result = await adapter.parseWebhook(body, 'tenant-1', {});
    expect(result!.contextMessageId).toBe('wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhgM');
    expect(result!.text).toBe('OPTION_YES');
  });

  it('leaves contextMessageId undefined on a regular (non-quote) text message', async () => {
    const body = {
      entry: [{
        changes: [{
          value: {
            messages: [{
              from: '919876543210',
              timestamp: '1700000000',
              type: 'text',
              text: { body: 'hello' },
              // no context field
            }],
          },
        }],
      }],
    };

    const result = await adapter.parseWebhook(body, 'tenant-1', {});

    expect(result).not.toBeNull();
    expect(result!.contextMessageId).toBeUndefined();
  });
});

describe('WhatsAppAdapter.sendMessage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the wamid from Meta API response messages[0].id', async () => {
    mockAxiosPost.mockResolvedValue({
      data: { messages: [{ id: 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhgM' }] },
    });

    const wamid = await makeAdapter().sendMessage({
      channel: 'whatsapp',
      recipientId: '+919876543210',
      content: [{ type: 'text', text: 'Hello' }],
    });

    expect(wamid).toBe('wamid.HBgMOTE5ODc2NTQzMjEwFQIAEhgM');
  });

  it('returns null when Meta API response has no messages array', async () => {
    mockAxiosPost.mockResolvedValue({ data: {} });

    const wamid = await makeAdapter().sendMessage({
      channel: 'whatsapp',
      recipientId: '+919876543210',
      content: [{ type: 'text', text: 'Hello' }],
    });

    expect(wamid).toBeNull();
  });
});
