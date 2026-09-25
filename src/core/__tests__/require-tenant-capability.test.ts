jest.mock('../tenant-context-storage');
jest.mock('../tenant-features');
jest.mock('../logger', () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
}));

import { getTenantContext } from '../tenant-context-storage';
import { getTenantFeatures, TenantFeatures } from '../tenant-features';
import { logger } from '../logger';
import { requireTenantCapability } from '../require-tenant-capability';

const mockGetTenantContext = getTenantContext as jest.Mock;
const mockGetTenantFeatures = getTenantFeatures as jest.Mock;

function makeFeatures(overrides: Partial<TenantFeatures> = {}): TenantFeatures {
  return {
    enabledSkills: ['symptom_check', 'qa'],
    enabledCapabilities: [],
    welcomeMessage: null,
    languageOptions: [],
    ...overrides,
  };
}

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('requireTenantCapability', () => {
  beforeEach(() => jest.clearAllMocks());

  it('calls next when the tenant has the required capability', async () => {
    mockGetTenantContext.mockReturnValue({ tenantId: 't-1' });
    mockGetTenantFeatures.mockResolvedValue(makeFeatures({ enabledCapabilities: ['screening'] }));
    const res = makeRes();
    const next = jest.fn();

    await requireTenantCapability('screening')({} as any, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('returns 404 and does not call next when capabilities are empty', async () => {
    mockGetTenantContext.mockReturnValue({ tenantId: 't-1' });
    mockGetTenantFeatures.mockResolvedValue(makeFeatures({ enabledCapabilities: [] }));
    const res = makeRes();
    const next = jest.fn();

    await requireTenantCapability('screening')({} as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 when a different capability is enabled', async () => {
    mockGetTenantContext.mockReturnValue({ tenantId: 't-1' });
    mockGetTenantFeatures.mockResolvedValue(makeFeatures({ enabledCapabilities: ['other'] }));
    const res = makeRes();
    const next = jest.fn();

    await requireTenantCapability('screening')({} as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 404 without consulting features when there is no tenant context', async () => {
    mockGetTenantContext.mockReturnValue(undefined);
    const res = makeRes();
    const next = jest.fn();

    await requireTenantCapability('screening')({} as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
    expect(next).not.toHaveBeenCalled();
    expect(mockGetTenantFeatures).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns 404 and logs when the feature lookup rejects', async () => {
    mockGetTenantContext.mockReturnValue({ tenantId: 't-1' });
    mockGetTenantFeatures.mockRejectedValue(new Error('boom'));
    const res = makeRes();
    const next = jest.fn();

    await requireTenantCapability('screening')({} as any, res as any, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Not found' });
    expect(next).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('returns a fresh handler per call that closes over its own capability name', async () => {
    const guardA = requireTenantCapability('a');
    const guardB = requireTenantCapability('b');
    expect(guardA).not.toBe(guardB);

    mockGetTenantContext.mockReturnValue({ tenantId: 't-1' });
    mockGetTenantFeatures.mockResolvedValue(makeFeatures({ enabledCapabilities: ['a'] }));

    const resA = makeRes();
    const nextA = jest.fn();
    await guardA({} as any, resA as any, nextA);
    expect(nextA).toHaveBeenCalledTimes(1);
    expect(resA.status).not.toHaveBeenCalled();

    const resB = makeRes();
    const nextB = jest.fn();
    await guardB({} as any, resB as any, nextB);
    expect(nextB).not.toHaveBeenCalled();
    expect(resB.status).toHaveBeenCalledWith(404);
  });
});
