import { resolveLocaleForTts } from '../resolve-locale';

function makePrisma(activePacks: string[]) {
  return {
    languagePack: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => {
        const match = activePacks.find(lc => lc === where.localeCode && where.isActive);
        return Promise.resolve(match ? { localeCode: match } : null);
      }),
    },
  };
}

describe('resolveLocaleForTts', () => {
  it('returns detected locale when active pack exists', async () => {
    const prisma = makePrisma(['ta-IN', 'hi-IN']);
    const result = await resolveLocaleForTts(prisma, 'ta-IN', 'hi-IN');
    expect(result).toBe('ta-IN');
  });

  it('returns fallback locale when detected locale has no active pack', async () => {
    const prisma = makePrisma(['hi-IN']);
    const result = await resolveLocaleForTts(prisma, 'ta-IN', 'hi-IN');
    expect(result).toBe('hi-IN');
  });

  it('returns en-IN when neither detected nor fallback locale has an active pack', async () => {
    const prisma = makePrisma([]);
    const result = await resolveLocaleForTts(prisma, 'ta-IN', 'hi-IN');
    expect(result).toBe('en-IN');
  });

  it('returns en-IN when detectedLocale is null and no fallback', async () => {
    const prisma = makePrisma([]);
    const result = await resolveLocaleForTts(prisma, null);
    expect(result).toBe('en-IN');
  });

  it('returns fallback locale when detectedLocale is null and fallback pack exists', async () => {
    const prisma = makePrisma(['en-IN']);
    const result = await resolveLocaleForTts(prisma, null, 'en-IN');
    expect(result).toBe('en-IN');
  });
});
