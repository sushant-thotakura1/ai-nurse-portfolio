/**
 * whatsapp-phone-guard.test.ts
 *
 * Verifies the `whatsAppPhoneGuard` middleware in isolation by mounting the
 * WhatsApp router inside a minimal Express app and firing requests via supertest.
 *
 * Scenarios tested:
 *  1. phone_number_id in payload MATCHES stored credential → request passes through
 *  2. phone_number_id in payload MISMATCHES stored credential → 200 returned, handler skipped
 *  3. No phone_number_id in payload (e.g. status update) → request passes through
 *  4. No credentials configured for tenant → 200 returned, handler skipped
 *  5. Cross-tenant fan-out: only matching tenant processes the message
 */

import express from 'express';
import request from 'supertest';

// ── Shared mock state (mutated per test) ──────────────────────────────────────

const mockProviderConfig = {
  findFirst: jest.fn(),
};

const mockPrisma = {
  providerConfig: mockProviderConfig,
};

const mockDecrypt = jest.fn((s: string) => s);

// ── Module mocks (must be declared before any import of routes) ───────────────

jest.mock('../../core/database', () => ({ prisma: mockPrisma }));
jest.mock('../../core/encryption', () => ({
  decrypt: (s: string) => mockDecrypt(s),
  encrypt: (s: string) => s,
}));
jest.mock('../../core/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../core/config', () => ({
  config: { providers: { openai: { apiKey: 'test-key' } } },
}));
jest.mock('../adapters/whatsapp.adapter', () => ({
  WhatsAppAdapter: jest.fn().mockImplementation(() => ({
    verifyWebhook: jest.fn().mockReturnValue(true),
    parseWebhook: jest.fn().mockResolvedValue(null), // null → no inbound to process
    sendMessage: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('../adapters/telegram.adapter', () => ({
  TelegramAdapter: jest.fn().mockImplementation(() => ({
    verifyWebhook: jest.fn().mockReturnValue(true),
    parseWebhook: jest.fn().mockResolvedValue(null),
  })),
}));
jest.mock('../messaging-orchestrator', () => ({
  MessagingOrchestrator: jest.fn().mockImplementation(() => ({
    handleInbound: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock('../../ai-agent/adapters/openai.adapter', () => ({
  OpenAIAdapter: jest.fn().mockImplementation(() => ({})),
}));

// ── Import AFTER mocks are in place ──────────────────────────────────────────

import { whatsappRoutes } from '../routes';
import { WhatsAppAdapter } from '../adapters/whatsapp.adapter';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Teach the mocks to return credentials for a given phoneNumberId. */
function setupCredentials(phoneNumberId: string) {
  const json = JSON.stringify({
    phoneNumberId,
    accessToken: 'tok',
    verifyToken: 'vtok',
    appSecret: 'secret',
  });
  mockDecrypt.mockReturnValue(json);
  mockProviderConfig.findFirst.mockResolvedValue({ config: { encrypted: json } });
}

/** Build a Meta webhook POST body with the given phone_number_id. */
function metaPayload(phoneNumberId: string | undefined) {
  if (!phoneNumberId) {
    // Status-update payload — no metadata block
    return {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { statuses: [{ id: 'abc' }] } }] }],
    };
  }
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: phoneNumberId, display_phone_number: '+1234567890' },
              messages: [
                {
                  from: '919999999999',
                  id: 'wamid.test',
                  timestamp: '1234567890',
                  type: 'text',
                  text: { body: 'hello' },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** Mount a fresh Express app with the WhatsApp router and a fake tenantContext. */
function buildApp(tenantId: string) {
  const app = express();
  app.use(express.json());
  app.use((_req, _res, next) => {
    (_req as any).tenantContext = { tenantId };
    next();
  });
  app.use('/webhooks/whatsapp', whatsappRoutes());
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('whatsAppPhoneGuard middleware', () => {
  const STORED_PHONE_ID = 'phone-111';
  const OTHER_PHONE_ID  = 'phone-999';

  beforeEach(() => jest.clearAllMocks());

  // ── 1. Matching phone_number_id ──────────────────────────────────────────

  it('passes the request through when phone_number_id matches stored credential', async () => {
    setupCredentials(STORED_PHONE_ID);

    const res = await request(buildApp('tenant-A'))
      .post('/webhooks/whatsapp')
      .send(metaPayload(STORED_PHONE_ID));

    expect(res.status).toBe(200);
    // WhatsAppAdapter was constructed → handler ran
    expect(WhatsAppAdapter).toHaveBeenCalledTimes(1);
  });

  // ── 2. Mismatched phone_number_id ────────────────────────────────────────

  it('returns 200 and skips the handler when phone_number_id does NOT match', async () => {
    setupCredentials(STORED_PHONE_ID);

    const res = await request(buildApp('tenant-B'))
      .post('/webhooks/whatsapp')
      .send(metaPayload(OTHER_PHONE_ID)); // different tenant's number

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    // Handler must NOT have run
    expect(WhatsAppAdapter).not.toHaveBeenCalled();
  });

  // ── 3. No phone_number_id (status update / no metadata) ─────────────────

  it('passes through when payload has no phone_number_id', async () => {
    setupCredentials(STORED_PHONE_ID);

    const res = await request(buildApp('tenant-A'))
      .post('/webhooks/whatsapp')
      .send(metaPayload(undefined));

    expect(res.status).toBe(200);
    // Guard must not block — WhatsAppAdapter is constructed
    expect(WhatsAppAdapter).toHaveBeenCalledTimes(1);
  });

  // ── 4. No credentials configured for tenant ──────────────────────────────

  it('returns 200 and skips handler when no credentials are configured', async () => {
    mockProviderConfig.findFirst.mockResolvedValue(undefined);
    mockDecrypt.mockImplementation(() => { throw new Error('nothing to decrypt'); });

    const res = await request(buildApp('tenant-C'))
      .post('/webhooks/whatsapp')
      .send(metaPayload(STORED_PHONE_ID));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(WhatsAppAdapter).not.toHaveBeenCalled();
  });

  // ── 5. Cross-tenant fan-out simulation ───────────────────────────────────
  //
  // Two tenants share the same Meta App. Meta delivers the same webhook to BOTH
  // endpoints. Only the tenant whose stored phoneNumberId matches must process it;
  // the other must silently drop it.

  it('cross-tenant fan-out: only the matching tenant processes the message', async () => {
    const TENANT_A_PHONE = 'phone-AAA';
    const TENANT_B_PHONE = 'phone-BBB';

    // --- Tenant A receives a message for phone-AAA (its own number) → processes it
    setupCredentials(TENANT_A_PHONE);
    const resA = await request(buildApp('tenant-A'))
      .post('/webhooks/whatsapp')
      .send(metaPayload(TENANT_A_PHONE));

    expect(resA.status).toBe(200);
    expect(WhatsAppAdapter).toHaveBeenCalledTimes(1); // adapter was created → message processed

    jest.clearAllMocks();

    // --- Tenant B also receives the SAME webhook (Meta fan-out) for phone-AAA → must drop it
    setupCredentials(TENANT_B_PHONE); // Tenant B stores a different number
    const resB = await request(buildApp('tenant-B'))
      .post('/webhooks/whatsapp')
      .send(metaPayload(TENANT_A_PHONE)); // payload still says phone-AAA

    expect(resB.status).toBe(200);
    expect(WhatsAppAdapter).not.toHaveBeenCalled(); // guard blocked it
  });
});
