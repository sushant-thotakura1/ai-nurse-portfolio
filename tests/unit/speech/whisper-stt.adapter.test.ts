import { WhisperSTTAdapter } from '../../../src/speech/adapters/whisper-stt.adapter';

// Mock the entire openai module
jest.mock('openai', () => {
  const mockCreate = jest.fn();
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      audio: { transcriptions: { create: mockCreate } },
    })),
    toFile: jest.fn().mockResolvedValue('mock-file'),
    _mockCreate: mockCreate,
  };
});

import * as OpenAIModule from 'openai';
const getMockCreate = () => (OpenAIModule as any)._mockCreate as jest.Mock;

describe('WhisperSTTAdapter', () => {
  let adapter: WhisperSTTAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    adapter = new WhisperSTTAdapter({ baseUrl: 'http://speaches:8000/v1', model: 'Systran/faster-whisper-large-v3' });
  });

  describe('transcribe', () => {
    it('returns a Transcript with text from the API response', async () => {
      getMockCreate().mockResolvedValue({ text: 'Hello, how are you feeling today?' });

      const result = await adapter.transcribe(Buffer.from('audio'), 'en-IN');

      expect(result.text).toBe('Hello, how are you feeling today?');
      expect(result.confidence).toBe(0);   // Whisper does not return confidence
      expect(result.locale).toBe('en-IN');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('calls the API with correct model and language', async () => {
      getMockCreate().mockResolvedValue({ text: 'नमस्ते' });

      await adapter.transcribe(Buffer.from('audio'), 'hi-IN');

      expect(getMockCreate()).toHaveBeenCalledWith(expect.objectContaining({
        model: 'Systran/faster-whisper-large-v3',
        language: 'hi',
      }));
    });

    it('throws when the API call fails', async () => {
      getMockCreate().mockRejectedValue(new Error('speaches unavailable'));

      await expect(
        adapter.transcribe(Buffer.from('audio'), 'en-IN')
      ).rejects.toThrow('speaches unavailable');
    });
  });

  describe('locale mapping', () => {
    const cases: Array<[string, string]> = [
      ['hi-IN', 'hi'], ['te-IN', 'te'], ['ta-IN', 'ta'], ['kn-IN', 'kn'],
      ['ml-IN', 'ml'], ['mr-IN', 'mr'], ['gu-IN', 'gu'], ['bn-IN', 'bn'],
      ['pa-IN', 'pa'], ['en-IN', 'en'],
    ];

    test.each(cases)('maps %s → %s', async (locale, expectedLang) => {
      getMockCreate().mockResolvedValue({ text: 'test' });
      await adapter.transcribe(Buffer.from('audio'), locale);
      expect(getMockCreate()).toHaveBeenCalledWith(
        expect.objectContaining({ language: expectedLang })
      );
    });
  });

  describe('streamTranscribe', () => {
    it('throws not-implemented', async () => {
      const gen = adapter.streamTranscribe(new ReadableStream(), 'en-IN');
      await expect(gen.next()).rejects.toThrow('Stream transcription not implemented for Whisper');
    });
  });
});
