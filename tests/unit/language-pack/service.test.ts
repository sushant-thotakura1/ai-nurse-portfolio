import { LanguagePackService } from '../../../src/language-pack/service';
import { prisma } from '../../../src/core/database';
import { cacheService } from '../../../src/core/cache';

// Mock Prisma
jest.mock('../../../src/core/database', () => ({
  prisma: {
    languagePack: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// Mock Cache Service
jest.mock('../../../src/core/cache');

describe('LanguagePackService', () => {
  let service: LanguagePackService;

  beforeEach(() => {
    service = new LanguagePackService();
    jest.clearAllMocks();
  });

  describe('getLanguagePack', () => {
    it('should return cached language pack if available', async () => {
      const mockPack = {
        localeCode: 'hi-IN',
        displayName: 'Hindi (India)',
        scripts: { greeting: 'नमस्ते' },
        medicalLexicon: { fever: 'बुखार' },
        voiceProfile: 'meera',
        sttHints: ['दवा', 'डॉक्टर'],
      };

      (cacheService.getLanguagePack as jest.Mock).mockResolvedValueOnce(mockPack);

      const result = await service.getLanguagePack('hi-IN');

      expect(result).toEqual(mockPack);
      expect(cacheService.getLanguagePack).toHaveBeenCalledWith('hi-IN');
      expect(prisma.languagePack.findUnique).not.toHaveBeenCalled();
    });

    it('should fetch from database and cache if not in cache', async () => {
      const mockPack = {
        id: 'uuid-1',
        localeCode: 'te-IN',
        displayName: 'Telugu (India)',
        scripts: { greeting: 'నమస్కారం' },
        medicalLexicon: { fever: 'జ్వరం' },
        voiceProfile: 'amala',
        sttHints: ['మందు', 'డాక్టర్'],
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (cacheService.getLanguagePack as jest.Mock).mockResolvedValueOnce(null);
      (prisma.languagePack.findUnique as jest.Mock).mockResolvedValueOnce(mockPack);

      const result = await service.getLanguagePack('te-IN');

      expect(result).toEqual(mockPack);
      expect(prisma.languagePack.findUnique).toHaveBeenCalledWith({
        where: { localeCode: 'te-IN' },
      });
      expect(cacheService.setLanguagePack).toHaveBeenCalledWith('te-IN', mockPack);
    });

    it('should throw error if language pack not found', async () => {
      (cacheService.getLanguagePack as jest.Mock).mockResolvedValueOnce(null);
      (prisma.languagePack.findUnique as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.getLanguagePack('unknown')).rejects.toThrow(
        'Language pack not found'
      );
    });
  });

  describe('getAllActiveLanguagePacks', () => {
    it('should return all active language packs', async () => {
      const mockPacks = [
        {
          id: 'uuid-1',
          localeCode: 'hi-IN',
          displayName: 'Hindi (India)',
          scripts: {},
          medicalLexicon: {},
          isActive: true,
        },
        {
          id: 'uuid-2',
          localeCode: 'te-IN',
          displayName: 'Telugu (India)',
          scripts: {},
          medicalLexicon: {},
          isActive: true,
        },
      ];

      (prisma.languagePack.findMany as jest.Mock).mockResolvedValueOnce(mockPacks);

      const result = await service.getAllActiveLanguagePacks();

      expect(result).toHaveLength(2);
      expect(prisma.languagePack.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: { displayName: 'asc' },
      });
    });
  });

  describe('getScript', () => {
    it('should return script for given key', async () => {
      const mockPack = {
        localeCode: 'hi-IN',
        scripts: {
          greeting: 'नमस्ते, मैं आपकी सहायक हूं',
          medicationReminder: 'क्या आपने अपनी दवा ली है?',
        },
      };

      (cacheService.getLanguagePack as jest.Mock).mockResolvedValueOnce(mockPack);

      const result = await service.getScript('hi-IN', 'greeting');

      expect(result).toBe('नमस्ते, मैं आपकी सहायक हूं');
    });

    it('should throw error if script key not found', async () => {
      const mockPack = {
        localeCode: 'hi-IN',
        scripts: { greeting: 'नमस्ते' },
      };

      (cacheService.getLanguagePack as jest.Mock).mockResolvedValueOnce(mockPack);

      await expect(service.getScript('hi-IN', 'nonexistent')).rejects.toThrow(
        "Script key 'nonexistent' not found in language pack hi-IN"
      );
    });
  });

  describe('getSTTHints', () => {
    it('should return STT hints for locale', async () => {
      const mockPack = {
        localeCode: 'hi-IN',
        sttHints: ['दवा', 'डॉक्टर', 'दर्द', 'बुखार'],
      };

      (cacheService.getLanguagePack as jest.Mock).mockResolvedValueOnce(mockPack);

      const result = await service.getSTTHints('hi-IN');

      expect(result).toEqual(['दवा', 'डॉक्टर', 'दर्द', 'बुखार']);
    });
  });
});
