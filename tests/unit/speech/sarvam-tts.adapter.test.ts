import { SarvamTTSAdapter } from '../../../src/speech/adapters/sarvam-tts.adapter';

// Mock axios
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SarvamTTSAdapter', () => {
  let adapter: SarvamTTSAdapter;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Create a mock axios instance
    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
    };

    // Mock axios.create to return our mock instance
    mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    adapter = new SarvamTTSAdapter({
      apiKey: 'test-api-key',
    });
  });

  describe('synthesize', () => {
    it('should synthesize Hindi text successfully', async () => {
      const text = 'नमस्ते, आप कैसे हैं?';
      const locale = 'hi-IN';

      const mockAudioBuffer = Buffer.from('fake-audio-data');

      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          audios: [mockAudioBuffer.toString('base64')],
        },
      });

      const result = await adapter.synthesize(text, locale);

      expect(result).toBeInstanceOf(Buffer);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should synthesize Telugu text successfully', async () => {
      const text = 'నమస్కారం, మీరు ఎలా ఉన్నారు?';
      const locale = 'te-IN';

      const mockAudioBuffer = Buffer.from('fake-audio-data');

      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          audios: [mockAudioBuffer.toString('base64')],
        },
      });

      const result = await adapter.synthesize(text, locale);

      expect(result).toBeInstanceOf(Buffer);
    });

    it('should use custom voice profile when provided', async () => {
      const text = 'आपका स्वागत है';
      const locale = 'hi-IN';
      const voiceProfile = 'female-1';

      const mockAudioBuffer = Buffer.from('fake-audio-data');

      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          audios: [mockAudioBuffer.toString('base64')],
        },
      });

      await adapter.synthesize(text, locale, voiceProfile);

      // Verify voice profile was sent in request
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/text-to-speech',
        expect.objectContaining({
          speaker: voiceProfile,
        })
      );
    });

    it('should handle synthesis errors gracefully', async () => {
      const text = 'test text';
      const locale = 'hi-IN';

      mockAxiosInstance.post.mockRejectedValueOnce(new Error('API Error'));

      await expect(adapter.synthesize(text, locale)).rejects.toThrow('Sarvam TTS failed');
    });
  });

  describe('getVoiceOptions', () => {
    it('should return available voice options for Hindi', async () => {
      const locale = 'hi-IN';

      mockAxiosInstance.get.mockResolvedValueOnce({
        data: {
          voices: [
            { id: 'meera', name: 'Meera', gender: 'female', language: 'hi-IN' },
            { id: 'arvind', name: 'Arvind', gender: 'male', language: 'hi-IN' },
          ],
        },
      });

      const voices = await adapter.getVoiceOptions(locale);

      expect(voices).toHaveLength(2);
      expect(voices[0].id).toBe('meera');
      expect(voices[0].gender).toBe('female');
    });
  });
});
