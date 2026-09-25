import { prisma } from '../core/database';
import { cacheService } from '../core/cache';
import { logger } from '../core/logger';

export class LanguagePackService {
  /**
   * Get language pack by locale code
   * Uses cache first, then database
   */
  async getLanguagePack(localeCode: string): Promise<any> {
    try {
      // Try cache first
      const cached = await cacheService.getLanguagePack(localeCode);
      if (cached) {
        logger.info('Language pack retrieved from cache', { localeCode });
        return cached;
      }

      // Cache miss - fetch from database
      logger.info('Language pack cache miss, fetching from database', { localeCode });
      const pack = await prisma.languagePack.findUnique({
        where: { localeCode },
      });

      if (!pack) {
        throw new Error(`Language pack not found for locale: ${localeCode}`);
      }

      // Store in cache for future requests
      cacheService.setLanguagePack(localeCode, pack);

      return pack;
    } catch (error: any) {
      logger.error('Failed to get language pack', {
        error: error.message,
        localeCode,
      });
      throw error;
    }
  }

  /**
   * Get all active language packs
   */
  async getAllActiveLanguagePacks(): Promise<any[]> {
    try {
      const packs = await prisma.languagePack.findMany({
        where: { isActive: true },
        orderBy: { displayName: 'asc' },
      });

      logger.info('Retrieved active language packs', { count: packs.length });
      return packs;
    } catch (error: any) {
      logger.error('Failed to get active language packs', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get a specific script by key from language pack
   */
  async getScript(localeCode: string, scriptKey: string): Promise<string> {
    try {
      const pack = await this.getLanguagePack(localeCode);

      const scripts = pack.scripts as Record<string, string>;
      if (!scripts[scriptKey]) {
        throw new Error(`Script key '${scriptKey}' not found in language pack ${localeCode}`);
      }

      return scripts[scriptKey];
    } catch (error: any) {
      logger.error('Failed to get script', {
        error: error.message,
        localeCode,
        scriptKey,
      });
      throw error;
    }
  }

  /**
   * Get STT hints for better transcription accuracy
   */
  async getSTTHints(localeCode: string): Promise<string[]> {
    try {
      const pack = await this.getLanguagePack(localeCode);
      return pack.sttHints || [];
    } catch (error: any) {
      logger.error('Failed to get STT hints', {
        error: error.message,
        localeCode,
      });
      throw error;
    }
  }

  /**
   * Get voice profile for TTS
   */
  async getVoiceProfile(localeCode: string): Promise<string | null> {
    try {
      const pack = await this.getLanguagePack(localeCode);
      return pack.voiceProfile || null;
    } catch (error: any) {
      logger.error('Failed to get voice profile', {
        error: error.message,
        localeCode,
      });
      throw error;
    }
  }

  /**
   * Get medical lexicon for locale
   */
  async getMedicalLexicon(localeCode: string): Promise<Record<string, string>> {
    try {
      const pack = await this.getLanguagePack(localeCode);
      return pack.medicalLexicon || {};
    } catch (error: any) {
      logger.error('Failed to get medical lexicon', {
        error: error.message,
        localeCode,
      });
      throw error;
    }
  }
}

export const languagePackService = new LanguagePackService();
