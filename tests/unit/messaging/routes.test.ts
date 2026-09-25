// tests/unit/messaging/routes.test.ts
import express from 'express';
import request from 'supertest';

jest.mock('../../../src/messaging/adapters/whatsapp.adapter');
jest.mock('../../../src/messaging/adapters/telegram.adapter');
jest.mock('../../../src/messaging/messaging-orchestrator');

// systemPrisma is now used for credential lookups; mock findFirst to return a record
// so the decrypt mock can return valid credentials without a real DB.
const mockSystemFindFirst = jest.fn().mockResolvedValue({ config: { encrypted: 'mock:creds' } });
jest.mock('../../../src/core/database', () => ({
  prisma: {},
  systemPrisma: { providerConfig: { findFirst: mockSystemFindFirst } },
}));

import { WhatsAppAdapter } from '../../../src/messaging/adapters/whatsapp.adapter';
import { TelegramAdapter } from '../../../src/messaging/adapters/telegram.adapter';
import { MessagingOrchestrator } from '../../../src/messaging/messaging-orchestrator';
import { whatsappRoutes, telegramRoutes } from '../../../src/messaging/routes';

const mockVerify = jest.fn();
const mockParse = jest.fn();
const mockHandle = jest.fn().mockResolvedValue(undefined);

beforeEach(() => {
  jest.clearAllMocks();
  // Restore systemPrisma.findFirst after clearAllMocks resets the implementation
  mockSystemFindFirst.mockResolvedValue({ config: { encrypted: 'mock:creds' } });
  (WhatsAppAdapter as jest.Mock).mockImplementation(() => ({
    verifyWebhook: mockVerify,
    parseWebhook: mockParse,
    sendMessage: jest.fn(),
  }));
  (TelegramAdapter as jest.Mock).mockImplementation(() => ({
    verifyWebhook: mockVerify,
    parseWebhook: mockParse,
    sendMessage: jest.fn(),
  }));
  (MessagingOrchestrator as jest.Mock).mockImplementation(() => ({
    handleInbound: mockHandle,
  }));
});

function buildApp() {
  const app = express();
  app.use(express.json());
  // Simulate tenantMiddleware setting req.tenantContext (the real middleware uses AsyncLocalStorage
  // but for route-handler tests the tenantContext object on req is sufficient)
  app.use((req: any, _res, next) => {
    req.tenantContext = { tenantId: 'tenant-test', tenantSlug: 'tenant-test' };
    next();
  });
  app.use('/v1/api/:tenantId/webhooks/whatsapp', whatsappRoutes());
  app.use('/v1/api/:tenantId/webhooks/telegram', telegramRoutes());
  return app;
}

// Mock encryption so credential decryption returns predictable test credentials
jest.mock('../../../src/core/encryption', () => ({
  decrypt: jest.fn().mockReturnValue('{"phoneNumberId":"pid","accessToken":"tok","verifyToken":"my-verify-token","appSecret":"secret"}'),
  encrypt: jest.fn(),
}));

describe('WhatsApp webhook routes', () => {
  it('GET returns hub.challenge when hub.verify_token matches', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/v1/api/tenant-test/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'my-verify-token', 'hub.challenge': '12345' });

    expect(res.status).toBe(200);
    expect(res.text).toBe('12345');
  });

  it('GET returns 403 when hub.verify_token does not match', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/v1/api/tenant-test/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': '12345' });

    expect(res.status).toBe(403);
  });

  it('POST returns 401 when HMAC signature is invalid', async () => {
    mockVerify.mockReturnValue(false);
    const app = buildApp();
    const res = await request(app)
      .post('/v1/api/tenant-test/webhooks/whatsapp')
      .send({ entry: [] });

    expect(res.status).toBe(401);
  });

  it('POST returns 200 and calls orchestrator for valid payload with matching phone_number_id', async () => {
    mockVerify.mockReturnValue(true);
    mockParse.mockResolvedValue({
      channel: 'whatsapp',
      senderId: '+919876543210',
      text: 'Hello',
      timestamp: new Date(),
      rawPayload: {},
    });
    const app = buildApp();

    const res = await request(app)
      .post('/v1/api/tenant-test/webhooks/whatsapp')
      .send({
        entry: [{
          changes: [{
            value: {
              metadata: { phone_number_id: 'pid' }, // matches mocked phoneNumberId
              messages: [{}],
            },
          }],
        }],
      });

    expect(res.status).toBe(200);
    expect(mockHandle).toHaveBeenCalled();
  });

  it('POST returns 200 silently and skips orchestrator when phone_number_id is absent in message event', async () => {
    mockVerify.mockReturnValue(true);
    const app = buildApp();

    // Message event without metadata.phone_number_id — guard should block to prevent
    // cross-tenant leakage (fail-closed behaviour).
    const res = await request(app)
      .post('/v1/api/tenant-test/webhooks/whatsapp')
      .send({ entry: [{ changes: [{ value: { messages: [{}] } }] }] });

    expect(res.status).toBe(200);
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it('POST returns 200 silently and skips orchestrator when phone_number_id mismatches tenant', async () => {
    mockVerify.mockReturnValue(true);
    const app = buildApp();

    // phone_number_id for a DIFFERENT tenant's phone — guard should block.
    const res = await request(app)
      .post('/v1/api/tenant-test/webhooks/whatsapp')
      .send({
        entry: [{
          changes: [{
            value: {
              metadata: { phone_number_id: 'other-tenant-pid' },
              messages: [{}],
            },
          }],
        }],
      });

    expect(res.status).toBe(200);
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it('POST returns 200 silently for status-update payloads (no messages)', async () => {
    mockVerify.mockReturnValue(true);
    mockParse.mockResolvedValue(null); // status update — no message to process
    const app = buildApp();

    const res = await request(app)
      .post('/v1/api/tenant-test/webhooks/whatsapp')
      .send({ entry: [] });

    expect(res.status).toBe(200);
    expect(mockHandle).not.toHaveBeenCalled();
  });

  it('credential lookup uses explicit tenantId from URL — not AsyncLocalStorage context', async () => {
    // Arrange: return no config for 'tenant-test' (simulates a different tenant's endpoint
    // receiving a webhook not meant for it)
    mockSystemFindFirst.mockResolvedValue(null);
    const app = buildApp();

    const res = await request(app)
      .post('/v1/api/tenant-test/webhooks/whatsapp')
      .send({
        entry: [{
          changes: [{ value: { metadata: { phone_number_id: 'pid' }, messages: [{}] } }],
        }],
      });

    // No active config → guard throws → skipped silently with 200
    expect(res.status).toBe(200);
    expect(mockHandle).not.toHaveBeenCalled();
    // Verify systemPrisma.findFirst was called with the explicit tenantId from the URL param
    expect(mockSystemFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: 'tenant-test' }) })
    );
  });
});

describe('Telegram webhook routes', () => {
  it('POST returns 401 when secret token is invalid', async () => {
    mockVerify.mockReturnValue(false);
    const app = buildApp();
    const res = await request(app)
      .post('/v1/api/tenant-test/webhooks/telegram')
      .send({ message: {} });

    expect(res.status).toBe(401);
  });

  it('POST returns 200 and calls orchestrator for valid payload', async () => {
    mockVerify.mockReturnValue(true);
    mockParse.mockResolvedValue({
      channel: 'telegram',
      senderId: '12345',
      text: 'Hi',
      timestamp: new Date(),
      rawPayload: {},
    });
    const app = buildApp();

    const res = await request(app)
      .post('/v1/api/tenant-test/webhooks/telegram')
      .send({ update_id: 1, message: { chat: { id: 12345 }, text: 'Hi' } });

    expect(res.status).toBe(200);
    expect(mockHandle).toHaveBeenCalled();
  });
});
