import { WhisperSTTAdapter } from '../adapters/whisper-stt.adapter';

const mockCreate = jest.fn();
jest.mock('openai', () => {
  const mockCtor = jest.fn().mockImplementation(() => ({
    audio: { transcriptions: { create: mockCreate } },
  }));
  return {
    __esModule: true,
    default: mockCtor,
    toFile: jest.fn().mockResolvedValue('mock-file'),
  };
});

function makeAdapter() {
  return new WhisperSTTAdapter({ baseUrl: 'http://localhost:8080', model: 'Systran/faster-whisper-large-v3' });
}

describe('WhisperSTTAdapter', () => {
  beforeEach(() => jest.clearAllMocks());

  it('omits language param when no locale provided (auto-detect)', async () => {
    mockCreate.mockResolvedValue({ text: 'hello', language: 'en' });

    await makeAdapter().transcribe(Buffer.from('audio'));

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.language).toBeUndefined();
  });

  it('sets Transcript.locale from normalised response language, not from input', async () => {
    mockCreate.mockResolvedValue({ text: 'hello', language: 'en' });

    const result = await makeAdapter().transcribe(Buffer.from('audio'));
    expect(result.locale).toBe('en-IN');
  });

  it('sends iso639 language when locale explicitly given', async () => {
    mockCreate.mockResolvedValue({ text: 'நமஸ்தே', language: 'ta' });

    await makeAdapter().transcribe(Buffer.from('audio'), 'ta-IN');

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.language).toBe('ta');
  });

  it('normalises all supported BCP-47 codes correctly', async () => {
    const cases: [string, string][] = [
      ['en', 'en-IN'], ['hi', 'hi-IN'], ['te', 'te-IN'], ['ta', 'ta-IN'],
      ['kn', 'kn-IN'], ['ml', 'ml-IN'], ['mr', 'mr-IN'], ['gu', 'gu-IN'],
      ['bn', 'bn-IN'], ['pa', 'pa-IN'],
    ];

    for (const [whisperCode, expected] of cases) {
      mockCreate.mockResolvedValue({ text: 'text', language: whisperCode });
      const result = await makeAdapter().transcribe(Buffer.from('audio'));
      expect(result.locale).toBe(expected);
    }
  });

  it('passes through unknown language codes with a warning (does not coerce to en)', async () => {
    mockCreate.mockResolvedValue({ text: 'text', language: 'fr' });

    const result = await makeAdapter().transcribe(Buffer.from('audio'));
    expect(result.locale).toBe('fr');   // pass through as-is
  });

  it('does not fall back to en for unmapped locales', async () => {
    mockCreate.mockResolvedValue({ text: 'text', language: 'de' });
    const result = await makeAdapter().transcribe(Buffer.from('audio'));
    expect(result.locale).not.toBe('en');
  });

  it('falls back to caller locale when Whisper returns no language field', async () => {
    mockCreate.mockResolvedValue({ text: 'hello' });  // no language field

    const result = await makeAdapter().transcribe(Buffer.from('audio'), 'ta-IN');
    expect(result.locale).toBe('ta-IN');
  });
});
