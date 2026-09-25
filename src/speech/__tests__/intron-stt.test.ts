import axios from 'axios';
import { IntronSTTAdapter } from '../adapters/intron-stt.adapter';

jest.mock('axios');
const mockAxios = axios as jest.Mocked<typeof axios>;

// 'OggS' magic bytes so detectAudioFormat picks audio/ogg
const OGG = Buffer.from([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0]);

describe('IntronSTTAdapter', () => {
  let adapter: IntronSTTAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAxios.create.mockReturnValue(mockAxios as any);
    adapter = new IntronSTTAdapter({ apiKey: 'test-key', pollIntervalMs: 0 });
  });

  // The live /upload/sync response carries the transcript inline but often still
  // reads processing_status: FILE_QUEUED at that point.
  const uploaded = (text: string, status = 'FILE_QUEUED') => ({
    data: { data: { file_id: 'f-1', processing_status: status, audio_transcript: text }, status: 'Ok' },
  });
  const uploadedNoTranscript = () => ({
    data: { data: { file_id: 'f-1', processing_status: 'FILE_QUEUED' }, status: 'Ok' },
  });

  it('POSTs once to /file/v1/upload/sync and returns the inline transcript (FILE_QUEUED)', async () => {
    mockAxios.post.mockResolvedValueOnce(uploaded('nauji ciwo'));

    const result = await adapter.transcribe(OGG, 'ha-NG');

    expect(mockAxios.post).toHaveBeenCalledTimes(1);
    expect(mockAxios.get).not.toHaveBeenCalled();
    expect(mockAxios.post).toHaveBeenCalledWith(
      '/file/v1/upload/sync',
      expect.any(Object),                       // FormData
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    expect(result.text).toBe('nauji ciwo');
    expect(result.confidence).toBe(1.0);
    expect(result.locale).toBe('ha-NG');
  });

  it('trims trailing whitespace/newline from the transcript', async () => {
    mockAxios.post.mockResolvedValueOnce(uploaded('Habari unajisikiaje leo.\n'));

    const result = await adapter.transcribe(OGG, 'sw-KE');

    expect(result.text).toBe('Habari unajisikiaje leo.');
  });

  it('polls /file/v1/status/{id} when the upload response has no transcript yet', async () => {
    mockAxios.post.mockResolvedValueOnce(uploadedNoTranscript());
    mockAxios.get
      .mockResolvedValueOnce({ data: { data: { processing_status: 'FILE_QUEUED' } } })
      .mockResolvedValueOnce({ data: { data: { processing_status: 'FILE_TRANSCRIBED', audio_transcript: 'done' } } });

    const result = await adapter.transcribe(OGG, 'sw-KE');

    expect(mockAxios.get).toHaveBeenCalledWith('/file/v1/status/f-1');
    expect(mockAxios.get).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('done');
  });

  it('sends use_language_asr_input = the mapped STT code', async () => {
    mockAxios.post.mockResolvedValueOnce(uploaded('habari'));

    await adapter.transcribe(OGG, 'sw-KE');

    const form = mockAxios.post.mock.calls[0][1] as any;
    // form-data stores appended fields on an internal stream; assert via its buffer
    const body = form.getBuffer().toString();
    expect(body).toMatch(/name="use_language_asr_input"\r\n\r\nsw\r\n/);
  });

  it('omits use_language_asr_input and defaults locale to en-NG when no locale is passed', async () => {
    mockAxios.post.mockResolvedValueOnce(uploaded('hello'));

    const result = await adapter.transcribe(OGG);

    const form = mockAxios.post.mock.calls[0][1] as any;
    expect(form.getBuffer().toString()).not.toContain('use_language_asr_input');
    expect(result.locale).toBe('en-NG');
  });

  it('throws on FILE_FAILED in the upload response', async () => {
    mockAxios.post.mockResolvedValueOnce({
      data: { data: { processing_status: 'FILE_FAILED', error_message: 'corrupt audio' }, status: 'Ok' },
    });

    await expect(adapter.transcribe(OGG, 'sw-KE')).rejects.toThrow('corrupt audio');
  });

  it('throws on FILE_FAILED discovered while polling', async () => {
    mockAxios.post.mockResolvedValueOnce(uploadedNoTranscript());
    mockAxios.get.mockResolvedValueOnce({ data: { data: { processing_status: 'FILE_FAILED', error_message: 'bad audio' } } });

    await expect(adapter.transcribe(OGG, 'sw-KE')).rejects.toThrow('bad audio');
  });

  it('throws a timeout error on HTTP 503 from the upload', async () => {
    mockAxios.post.mockRejectedValueOnce({ response: { status: 503 } });

    await expect(adapter.transcribe(OGG, 'sw-KE')).rejects.toThrow(/timed out/i);
  });

  it('times out when polling never yields a transcript', async () => {
    adapter = new IntronSTTAdapter({ apiKey: 'k', pollIntervalMs: 0, pollTimeoutMs: 1 });
    mockAxios.post.mockResolvedValueOnce(uploadedNoTranscript());
    mockAxios.get.mockResolvedValue({ data: { data: { processing_status: 'FILE_QUEUED' } } });

    await expect(adapter.transcribe(OGG, 'sw-KE')).rejects.toThrow(/timed out/i);
  });

  it('streamTranscribe throws not-implemented', async () => {
    const iterator = adapter.streamTranscribe({} as ReadableStream, 'en');
    await expect(iterator.next()).rejects.toThrow(/not.*implemented/i);
  });
});
