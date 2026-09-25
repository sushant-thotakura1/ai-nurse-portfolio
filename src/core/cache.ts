import NodeCache from 'node-cache';
import { logger } from './logger';

export class CacheService {
  private languagePackCache: NodeCache;
  private providerConfigCache: NodeCache;

  constructor() {
    // Language packs: 1 hour TTL
    this.languagePackCache = new NodeCache({
      stdTTL: 3600,
      checkperiod: 600,
    });

    // Provider configs: 10 minute TTL
    this.providerConfigCache = new NodeCache({
      stdTTL: 600,
      checkperiod: 120,
    });

    logger.info('In-memory cache initialized');
  }

  async getLanguagePack(locale: string): Promise<any | null> {
    return this.languagePackCache.get(locale) || null;
  }

  setLanguagePack(locale: string, pack: any): void {
    this.languagePackCache.set(locale, pack);
  }

  async getProviderConfig(providerType: string): Promise<any | null> {
    return this.providerConfigCache.get(providerType) || null;
  }

  setProviderConfig(providerType: string, config: any): void {
    this.providerConfigCache.set(providerType, config);
  }

  clear(): void {
    this.languagePackCache.flushAll();
    this.providerConfigCache.flushAll();
    logger.info('All caches cleared');
  }
}

export const cacheService = new CacheService();
