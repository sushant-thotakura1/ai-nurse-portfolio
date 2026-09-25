jest.mock('../database', () => ({
  prisma: { tenant: { findUnique: jest.fn() } },
}));
jest.mock('../logger', () => ({ logger: { error: jest.fn() } }));

import { prisma } from '../database';
import { getTenantFeatures } from '../tenant-features';

const mockFindUnique = prisma.tenant.findUnique as jest.Mock;

const DEFAULTS = { enabledSkills: ['symptom_check', 'qa'], enabledCapabilities: [], welcomeMessage: null, languageOptions: [] };

describe('getTenantFeatures', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns defaults when tenant has no settings', async () => {
    mockFindUnique.mockResolvedValue({ settings: null });
    expect(await getTenantFeatures('t-1')).toEqual(DEFAULTS);
  });

  it('returns defaults when settings.features is absent', async () => {
    mockFindUnique.mockResolvedValue({ settings: {} });
    expect(await getTenantFeatures('t-1')).toEqual(DEFAULTS);
  });

  it('returns defaults when enabledSkills contains only unknown values', async () => {
    mockFindUnique.mockResolvedValue({ settings: { features: { enabledSkills: ['unknown'] } } });
    expect(await getTenantFeatures('t-1')).toEqual(DEFAULTS);
  });

  it('returns defaults when enabledSkills is not an array', async () => {
    mockFindUnique.mockResolvedValue({ settings: { features: { enabledSkills: 'qa' } } });
    expect(await getTenantFeatures('t-1')).toEqual(DEFAULTS);
  });

  it('returns qa-only config for FAQ-only tenant', async () => {
    mockFindUnique.mockResolvedValue({
      settings: { features: { enabledSkills: ['qa'] } },
    });
    expect(await getTenantFeatures('t-1')).toEqual({
      enabledSkills: ['qa'],
      enabledCapabilities: [],
      welcomeMessage: null,
      languageOptions: [],
    });
  });

  it('returns welcome message when set', async () => {
    mockFindUnique.mockResolvedValue({
      settings: { features: { enabledSkills: ['qa'], welcomeMessage: 'Hello!' } },
    });
    expect(await getTenantFeatures('t-1')).toEqual({
      enabledSkills: ['qa'],
      enabledCapabilities: [],
      welcomeMessage: 'Hello!',
      languageOptions: [],
    });
  });

  it('ignores non-string welcomeMessage', async () => {
    mockFindUnique.mockResolvedValue({
      settings: { features: { enabledSkills: ['qa'], welcomeMessage: 123 } },
    });
    expect(await getTenantFeatures('t-1')).toEqual({
      enabledSkills: ['qa'],
      enabledCapabilities: [],
      welcomeMessage: null,
      languageOptions: [],
    });
  });

  it('returns defaults on DB error', async () => {
    mockFindUnique.mockRejectedValue(new Error('DB down'));
    expect(await getTenantFeatures('t-1')).toEqual(DEFAULTS);
  });
});

describe('getTenantFeatures — capabilities', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns enabledCapabilities when set to a known value', async () => {
    mockFindUnique.mockResolvedValue({
      settings: { features: { enabledSkills: ['qa', 'symptom_check'], enabledCapabilities: ['screening'] } },
    });
    expect((await getTenantFeatures('t-1')).enabledCapabilities).toEqual(['screening']);
  });

  it('filters out unknown capability values', async () => {
    mockFindUnique.mockResolvedValue({
      settings: { features: { enabledSkills: ['qa'], enabledCapabilities: ['bogus'] } },
    });
    expect((await getTenantFeatures('t-1')).enabledCapabilities).toEqual([]);
  });

  it('returns [] when enabledCapabilities is not an array', async () => {
    mockFindUnique.mockResolvedValue({
      settings: { features: { enabledSkills: ['qa'], enabledCapabilities: 'screening' } },
    });
    expect((await getTenantFeatures('t-1')).enabledCapabilities).toEqual([]);
  });

  it('returns [] when features has enabledSkills but no enabledCapabilities key', async () => {
    mockFindUnique.mockResolvedValue({
      settings: { features: { enabledSkills: ['qa'] } },
    });
    expect((await getTenantFeatures('t-1')).enabledCapabilities).toEqual([]);
  });

  it('returns both skills and capabilities together', async () => {
    mockFindUnique.mockResolvedValue({
      settings: { features: { enabledSkills: ['qa'], enabledCapabilities: ['screening'] } },
    });
    expect(await getTenantFeatures('t-1')).toEqual({
      enabledSkills: ['qa'],
      enabledCapabilities: ['screening'],
      welcomeMessage: null,
      languageOptions: [],
    });
  });

  it('returns [] capabilities as part of defaults on DB error', async () => {
    mockFindUnique.mockRejectedValue(new Error('DB down'));
    expect((await getTenantFeatures('t-1')).enabledCapabilities).toEqual([]);
  });
});

describe('getTenantFeatures — languageOptions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('parses a string array from settings.features.languageOptions', async () => {
    mockFindUnique.mockResolvedValue({
      settings: { features: { enabledSkills: ['qa'], languageOptions: ['ha-NG', 'sw-KE'] } },
    });
    expect((await getTenantFeatures('t-1')).languageOptions).toEqual(['ha-NG', 'sw-KE']);
  });

  it('filters out non-string entries', async () => {
    mockFindUnique.mockResolvedValue({
      settings: { features: { enabledSkills: ['qa'], languageOptions: ['ha-NG', 3, null, 'sw-KE'] } },
    });
    expect((await getTenantFeatures('t-1')).languageOptions).toEqual(['ha-NG', 'sw-KE']);
  });

  it('returns [] when languageOptions is absent', async () => {
    mockFindUnique.mockResolvedValue({ settings: { features: { enabledSkills: ['qa'] } } });
    expect((await getTenantFeatures('t-1')).languageOptions).toEqual([]);
  });

  it('returns [] when languageOptions is not an array', async () => {
    mockFindUnique.mockResolvedValue({
      settings: { features: { enabledSkills: ['qa'], languageOptions: 'ha-NG' } },
    });
    expect((await getTenantFeatures('t-1')).languageOptions).toEqual([]);
  });

  it('recognises the language_selection capability', async () => {
    mockFindUnique.mockResolvedValue({
      settings: { features: { enabledSkills: ['qa'], enabledCapabilities: ['language_selection'] } },
    });
    expect((await getTenantFeatures('t-1')).enabledCapabilities).toEqual(['language_selection']);
  });
});
