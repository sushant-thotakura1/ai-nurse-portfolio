import axios from 'axios';
import { IntronTTSAdapter } from '../adapters/intron-tts.adapter';

jest.mock('axios');
const mockAxios = axios as jest.Mocked<typeof axios>;

describe('IntronTTSAdapter', () => {
  let adapter: IntronTTSAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAxios.create.mockReturnValue(mockAxios as any);
    adapter = new IntronTTSAdapter({ apiKey: 'test-key' });
  });

  const generated = (audioPath: string) => ({
    data: { data: { audio_path: audioPath, processing_status: 'TTS_TEXT_AUDIO_GENERATED' }, status: 'Ok' },
  });

  it('sends one /tts/v1/generate call with the mapped language + accent and returns a Buffer', async () => {
    mockAxios.post.mockResolvedValueOnce(generated('https://cdn.intron.io/a.wav'));
    mockAxios.get.mockResolvedValueOnce({ data: Buffer.from('audio-bytes') });

    const result = await adapter.synthesize('Sannu', 'ha-NG');

    expect(mockAxios.post).toHaveBeenCalledWith('/tts/v1/generate', {
      text: 'Sannu',
      voice_language: 'ha',
      voice_accent: 'hausa',
      voice_gender: 'female',
      output_audio_format: 'wav',
    });
    expect(mockAxios.get).toHaveBeenCalledWith('https://cdn.intron.io/a.wav', { responseType: 'arraybuffer' });
    expect(result).toBeInstanceOf(Buffer);
    expect(mockAxios.post).toHaveBeenCalledTimes(1);
  });

  it('uses voice_language "en" for en-NG', async () => {
    mockAxios.post.mockResolvedValueOnce(generated('https://cdn.intron.io/b.wav'));
    mockAxios.get.mockResolvedValueOnce({ data: Buffer.from('x') });

    await adapter.synthesize('Hello', 'en-NG');

    expect(mockAxios.post).toHaveBeenCalledWith(
      '/tts/v1/generate',
      expect.objectContaining({ voice_language: 'en', voice_accent: 'yoruba' }),
    );
  });

  it('falls back to the en-NG voice params for an unmapped locale', async () => {
    mockAxios.post.mockResolvedValueOnce(generated('https://cdn.intron.io/c.wav'));
    mockAxios.get.mockResolvedValueOnce({ data: Buffer.from('x') });

    await adapter.synthesize('Hello', 'fr-FR');

    expect(mockAxios.post).toHaveBeenCalledWith(
      '/tts/v1/generate',
      expect.objectContaining({ voice_language: 'en', voice_accent: 'yoruba' }),
    );
  });

  it('throws when text exceeds 4096 characters', async () => {
    await expect(adapter.synthesize('a'.repeat(4097), 'sw-KE')).rejects.toThrow(/4096/);
    expect(mockAxios.post).not.toHaveBeenCalled();
  });

  it('throws when processing_status is not TTS_TEXT_AUDIO_GENERATED', async () => {
    mockAxios.post.mockResolvedValueOnce({
      data: { data: { processing_status: 'TTS_TEXT_FAILED', error_message: 'bad accent' }, status: 'Ok' },
    });

    await expect(adapter.synthesize('Hi', 'sw-KE')).rejects.toThrow('bad accent');
  });

  it('throws a clear cold-start message on HTTP 503', async () => {
    mockAxios.post.mockRejectedValueOnce({ response: { status: 503 } });

    await expect(adapter.synthesize('Hi', 'sw-KE')).rejects.toThrow(/503.*cold-start/i);
  });

  it('throws when the completed response has no audio_path', async () => {
    mockAxios.post.mockResolvedValueOnce({
      data: { data: { processing_status: 'TTS_TEXT_AUDIO_GENERATED' }, status: 'Ok' },
    });

    await expect(adapter.synthesize('Hi', 'sw-KE')).rejects.toThrow(/audio_path/);
  });

  it('getVoiceOptions returns an empty array', async () => {
    expect(await adapter.getVoiceOptions('ha-NG')).toEqual([]);
  });
});
