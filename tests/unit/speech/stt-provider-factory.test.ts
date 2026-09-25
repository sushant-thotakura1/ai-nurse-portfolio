jest.mock('../../../src/core/encryption', () => ({
  decrypt: jest.fn((val: string) => val),   // passthrough for tests
  encrypt: jest.fn((val: string) => val),
}));

jest.mock('../../../src/core/config', () => ({
  config: {
    providers: {
      sarvam: { apiKey: 'test-sarvam-key' },
      stt: {
        whisperBaseUrl: 'http://speaches:8000/v1',
        defaultProvider: 'sarvam',
      },
    },
  },
}));

import { getSttProvider } from '../../../src/speech/stt-provider.factory';
import { WhisperSTTAdapter } from '../../../src/speech/adapters/whisper-stt.adapter';
import { SarvamSTTAdapter } from '../../../src/speech/adapters/sarvam-stt.adapter';

function makeEncryptedConfig(obj: object): object {
  return { config: { encrypted: JSON.stringify(obj) } };
}

const mockFindFirst = jest.fn();
const mockPrisma = {
  providerConfig: { findFirst: mockFindFirst },
};

beforeEach(() => jest.clearAllMocks());

describe('getSttProvider', () => {
  it('returns WhisperSTTAdapter when DB record providerName is "whisper"', async () => {
    mockFindFirst.mockResolvedValue({
      providerName: 'whisper',
      ...makeEncryptedConfig({ baseUrl: 'http://speaches:8000/v1' }),
    });

    const provider = await getSttProvider('tenant-1', mockPrisma);

    expect(provider).toBeInstanceOf(WhisperSTTAdapter);
    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { providerType: 'stt', tenantId: 'tenant-1', isActive: true },
      orderBy: { priority: 'desc' },
    }));
  });

  it('returns SarvamSTTAdapter when DB record providerName is "sarvam"', async () => {
    mockFindFirst.mockResolvedValue({
      providerName: 'sarvam',
      ...makeEncryptedConfig({ apiKey: 'sarvam-from-db' }),
    });

    const provider = await getSttProvider('tenant-1', mockPrisma);
    expect(provider).toBeInstanceOf(SarvamSTTAdapter);
  });

  it('returns SarvamSTTAdapter (env fallback) when no DB record and defaultProvider is sarvam', async () => {
    mockFindFirst.mockResolvedValue(null);

    const provider = await getSttProvider('tenant-1', mockPrisma);
    expect(provider).toBeInstanceOf(SarvamSTTAdapter);
  });

  it('returns WhisperSTTAdapter (env fallback) when no DB record and defaultProvider is whisper', async () => {
    jest.resetModules();
    jest.doMock('../../../src/core/config', () => ({
      config: {
        providers: {
          sarvam: { apiKey: '' },
          stt: { whisperBaseUrl: 'http://speaches:8000/v1', defaultProvider: 'whisper' },
        },
      },
    }));
    mockFindFirst.mockResolvedValue(null);

    const { getSttProvider: getFreshFactory } = await import('../../../src/speech/stt-provider.factory');
    const { WhisperSTTAdapter: FreshWhisper } = await import('../../../src/speech/adapters/whisper-stt.adapter');
    const provider = await getFreshFactory('tenant-1', mockPrisma);
    expect(provider).toBeInstanceOf(FreshWhisper);
  });

  it('throws when no DB record, defaultProvider is sarvam, and SARVAM_API_KEY is absent', async () => {
    jest.resetModules();
    jest.doMock('../../../src/core/config', () => ({
      config: {
        providers: {
          sarvam: { apiKey: '' },   // no api key
          stt: { whisperBaseUrl: 'http://speaches:8000/v1', defaultProvider: 'sarvam' },
        },
      },
    }));
    mockFindFirst.mockResolvedValue(null);

    const { getSttProvider: getFreshFactory } = await import('../../../src/speech/stt-provider.factory');
    await expect(getFreshFactory('tenant-1', mockPrisma)).rejects.toThrow(
      'No STT provider configured'
    );
  });

  it('selects the highest-priority record when multiple active STT records exist', async () => {
    // findFirst with orderBy: priority desc returns the highest-priority record
    mockFindFirst.mockResolvedValue({
      providerName: 'whisper',
      ...makeEncryptedConfig({ baseUrl: 'http://speaches:8000/v1' }),
    });

    const provider = await getSttProvider('tenant-1', mockPrisma);
    expect(provider).toBeInstanceOf(WhisperSTTAdapter);
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { priority: 'desc' } })
    );
  });
});
