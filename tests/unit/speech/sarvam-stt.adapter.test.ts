import { SarvamSTTAdapter } from '../../../src/speech/adapters/sarvam-stt.adapter';

// Mock axios
jest.mock('axios');
import axios from 'axios';
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('SarvamSTTAdapter', () => {
  let adapter: SarvamSTTAdapter;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Create a mock axios instance
    mockAxiosInstance = {
      post: jest.fn(),
    };

    // Mock axios.create to return our mock instance
    mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    adapter = new SarvamSTTAdapter({
      apiKey: 'test-api-key',
    });
  });

  describe('transcribe', () => {
    it('should transcribe Hindi audio successfully', async () => {
      const audioBuffer = Buffer.from('fake-audio-data');
      const locale = 'hi-IN';

      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          transcript: 'नमस्ते, मैं ठीक हूं',
          confidence: 0.95,
          language: 'hi-IN',
        },
      });

      const result = await adapter.transcribe(audioBuffer, locale);

      expect(result.text).toBe('नमस्ते, मैं ठीक हूं');
      expect(result.confidence).toBe(0.95);
      expect(result.locale).toBe('hi-IN');
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('should transcribe Telugu audio successfully', async () => {
      const audioBuffer = Buffer.from('fake-audio-data');
      const locale = 'te-IN';

      mockAxiosInstance.post.mockResolvedValueOnce({
        data: {
          transcript: 'నమస్కారం, నేను బాగున్నాను',
          confidence: 0.92,
          language: 'te-IN',
        },
      });

      const result = await adapter.transcribe(audioBuffer, locale);

      expect(result.text).toBe('నమస్కారం, నేను బాగున్నాను');
      expect(result.confidence).toBe(0.92);
      expect(result.locale).toBe('te-IN');
    });

  });
});
