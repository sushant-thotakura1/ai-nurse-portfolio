import request from 'supertest';
import app from '../../src/server';
import { ChannelsService } from '../../src/messaging/channels.service';

// Mock the entire ChannelsService
jest.mock('../../src/messaging/channels.service');
const MockChannelsService = ChannelsService as jest.MockedClass<typeof ChannelsService>;

// Mock auth middleware to inject admin user
jest.mock('../../src/admin/auth/middleware', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.user = { userId: 'u1', role: 'admin' };
    next();
  },
  requireRole: (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!roles.includes(req.user?.role)) return res.status(403).json({ error: 'Forbidden' });
    next();
  },
}));

// Mock tenant middleware
jest.mock('../../src/core/tenant-middleware', () => ({
  createTenantMiddleware: () => (req: any, _res: any, next: any) => {
    req.tenantContext = { tenantId: 'tenant-123', tenantName: 'test' };
    next();
  },
}));

const TENANT_ID = 'tenant-123';

describe('GET /v1/api/:tenantId/channels', () => {
  it('returns 200 with channel summaries for admin', async () => {
    MockChannelsService.prototype.getChannels = jest.fn().mockResolvedValue([
      { channel: 'telegram', configured: true, isActive: true, lastRegisteredAt: null, maskedSecrets: {} },
    ]);
    MockChannelsService.prototype.getBaseUrl = jest.fn().mockResolvedValue('https://example.com');

    const res = await request(app)
      .get(`/v1/api/${TENANT_ID}/channels`)
      .set('Authorization', 'Bearer faketoken');

    expect(res.status).toBe(200);
    expect(res.body.channels).toHaveLength(1);
    expect(res.body.baseUrl).toBe('https://example.com');
  });

  it('returns 403 for non-admin role', async () => {
    jest.spyOn(require('../../src/admin/auth/middleware'), 'authMiddleware')
      .mockImplementationOnce((req: any, _res: any, next: any) => {
        req.user = { userId: 'u2', role: 'user' };
        next();
      });

    const res = await request(app)
      .get(`/v1/api/${TENANT_ID}/channels`)
      .set('Authorization', 'Bearer faketoken');

    expect(res.status).toBe(403);
  });
});

describe('PUT /v1/api/:tenantId/channels/telegram', () => {
  it('returns 200 with status active on success', async () => {
    MockChannelsService.prototype.saveAndActivate = jest.fn().mockResolvedValue({
      status: 'active', webhookUrl: 'https://x/webhooks/telegram', lastRegisteredAt: new Date().toISOString(),
    });
    MockChannelsService.prototype.getBaseUrl = jest.fn().mockResolvedValue('https://example.com');

    const res = await request(app)
      .put(`/v1/api/${TENANT_ID}/channels/telegram`)
      .set('Authorization', 'Bearer faketoken')
      .send({ botToken: 'bot:TOKEN', secretToken: 'secret' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  it('returns 400 when Telegram registration fails', async () => {
    MockChannelsService.prototype.saveAndActivate = jest.fn().mockRejectedValue(new Error('Bad Token'));
    MockChannelsService.prototype.getBaseUrl = jest.fn().mockResolvedValue('https://example.com');

    const res = await request(app)
      .put(`/v1/api/${TENANT_ID}/channels/telegram`)
      .set('Authorization', 'Bearer faketoken')
      .send({ botToken: 'bad', secretToken: 'sec' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Bad Token');
  });

  it('returns 400 when App Base URL is not set', async () => {
    MockChannelsService.prototype.getBaseUrl = jest.fn().mockResolvedValue('');

    const res = await request(app)
      .put(`/v1/api/${TENANT_ID}/channels/telegram`)
      .set('Authorization', 'Bearer faketoken')
      .send({ botToken: 'bot:TOKEN', secretToken: 'secret' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Base URL');
  });

  it('returns 400 for unsupported channel', async () => {
    const res = await request(app)
      .put(`/v1/api/${TENANT_ID}/channels/sms`)
      .set('Authorization', 'Bearer faketoken')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Unsupported channel');
  });
});

describe('DELETE /v1/api/:tenantId/channels/telegram', () => {
  it('returns 200 with warning if deleteWebhook failed', async () => {
    MockChannelsService.prototype.deactivate = jest.fn().mockResolvedValue({
      warning: 'Could not deregister webhook',
    });

    const res = await request(app)
      .delete(`/v1/api/${TENANT_ID}/channels/telegram`)
      .set('Authorization', 'Bearer faketoken');

    expect(res.status).toBe(200);
    expect(res.body.warning).toBeDefined();
  });

  it('returns 400 for unsupported channel', async () => {
    const res = await request(app)
      .delete(`/v1/api/${TENANT_ID}/channels/sms`)
      .set('Authorization', 'Bearer faketoken');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Unsupported channel');
  });
});
