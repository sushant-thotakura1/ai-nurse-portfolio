import { KnowledgeGraphService } from '../../../src/knowledge-graph/knowledge-graph.service';
import { prisma } from '../../../src/core/database';
import { runWithTenantContext } from '../../../src/core/tenant-context-storage';
import { TenantContext } from '../../../src/core/types';

jest.mock('../../../src/core/database', () => ({
  prisma: {
    knowledgeGraph: {
      findMany: jest.fn(),
    },
  },
}));

const mockTenantContext: TenantContext = {
  tenantId: 'tenant-123',
  tenantSlug: 'test-tenant',
  tenant: {
    id: 'tenant-123',
    slug: 'test-tenant',
    name: 'Test Tenant',
    status: 'ACTIVE',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as any,
  isSuperAdmin: false,
};

describe('KnowledgeGraphService.listKnowledgeGraphs', () => {
  let service: KnowledgeGraphService;

  beforeEach(() => {
    service = new KnowledgeGraphService();
    jest.clearAllMocks();
  });

  it('returns conditionType from jsonData for a hybrid KG', async () => {
    (prisma.knowledgeGraph.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: 'kg-1',
        condition: 'Sickle Cell Anemia',
        version: '1.0',
        status: 'ACTIVE',
        isValid: true,
        phaseNames: ['phase_1'],
        createdAt: new Date(),
        updatedAt: new Date(),
        jsonData: {
          condition: {
            condition_type: 'hybrid',
            classifications: { 'HbSS': {}, 'HbSC': {} },
          },
        },
      },
    ]);

    const result = await runWithTenantContext(mockTenantContext, () =>
      service.listKnowledgeGraphs({})
    );

    expect(result[0].conditionType).toBe('hybrid');
    expect(result[0].classifications).toEqual(['HbSS', 'HbSC']);
  });

  it('returns conditionType for an episodic KG', async () => {
    (prisma.knowledgeGraph.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: 'kg-2',
        condition: 'Cardiac Surgery',
        version: '1.0',
        status: 'ACTIVE',
        isValid: true,
        phaseNames: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        jsonData: {
          condition: {
            condition_type: 'episodic',
            classifications: { 'CABG': {} },
          },
        },
      },
    ]);

    const result = await runWithTenantContext(mockTenantContext, () =>
      service.listKnowledgeGraphs({})
    );

    expect(result[0].conditionType).toBe('episodic');
  });

  it('returns null conditionType when jsonData lacks condition_type', async () => {
    (prisma.knowledgeGraph.findMany as jest.Mock).mockResolvedValueOnce([
      {
        id: 'kg-3',
        condition: 'Legacy Condition',
        version: '1.0',
        status: 'ACTIVE',
        isValid: true,
        phaseNames: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        jsonData: { condition: { classifications: {} } },
      },
    ]);

    const result = await runWithTenantContext(mockTenantContext, () =>
      service.listKnowledgeGraphs({})
    );

    expect(result[0].conditionType).toBeNull();
  });
});
