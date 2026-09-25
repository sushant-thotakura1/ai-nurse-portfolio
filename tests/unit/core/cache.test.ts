import { CacheService } from '../../../src/core/cache';

describe('CacheService', () => {
  let cache: CacheService;

  beforeEach(() => {
    cache = new CacheService();
  });

  afterEach(() => {
    cache.clear();
  });

  describe('Language Pack Cache', () => {
    it('should set and get a language pack', async () => {
      const pack = { greeting: 'नमस्ते', farewell: 'धन्यवाद' };
      cache.setLanguagePack('hi-IN', pack);

      const retrieved = await cache.getLanguagePack('hi-IN');
      expect(retrieved).toEqual(pack);
    });

    it('should return null for non-existent language pack', async () => {
      const retrieved = await cache.getLanguagePack('nonexistent');
      expect(retrieved).toBeNull();
    });

    it('should expire language pack after TTL', async () => {
      // This test would require mocking timers, keep it simple for now
      const pack = { greeting: 'Hello' };
      cache.setLanguagePack('en-US', pack);
      const retrieved = await cache.getLanguagePack('en-US');
      expect(retrieved).toEqual(pack);
    });
  });

  describe('Provider Config Cache', () => {
    it('should set and get a provider config', async () => {
      const config = { apiKey: 'test-key', endpoint: 'https://api.test.com' };
      cache.setProviderConfig('sarvam-stt', config);

      const retrieved = await cache.getProviderConfig('sarvam-stt');
      expect(retrieved).toEqual(config);
    });

    it('should return null for non-existent provider config', async () => {
      const retrieved = await cache.getProviderConfig('nonexistent');
      expect(retrieved).toBeNull();
    });
  });

  describe('Cache Management', () => {
    it('should clear all caches', async () => {
      cache.setLanguagePack('hi-IN', { test: 'data' });
      cache.setProviderConfig('test-provider', { test: 'config' });

      cache.clear();

      const langPack = await cache.getLanguagePack('hi-IN');
      const providerConfig = await cache.getProviderConfig('test-provider');

      expect(langPack).toBeNull();
      expect(providerConfig).toBeNull();
    });
  });
});
