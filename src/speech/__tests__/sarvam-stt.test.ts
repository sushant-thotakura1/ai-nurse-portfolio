import axios from 'axios';
import { SarvamSTTAdapter } from '../adapters/sarvam-stt.adapter';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

function makeAdapter() {
  const instance = {
    post: jest.fn(),
  } as any;
  mockedAxios.create.mockReturnValue(instance);
  return { adapter: new SarvamSTTAdapter({ apiKey: 'test-key' }), instance };
}

/**
 * The `form-data` npm package does not implement `.get()`.
 * Values are stored in `_streams` as alternating header/value/delimiter triples.
 * This helper extracts the value for a named field.
 */
function getFormField(formData: any, fieldName: string): string | undefined {
  const streams: any[] = formData._streams || [];
  for (let i = 0; i < streams.length - 1; i++) {
    const entry = streams[i];
    if (typeof entry === 'string' && entry.includes(`name="${fieldName}"`)) {
      // The value immediately follows the header string
      const value = streams[i + 1];
      if (typeof value === 'string') return value;
    }
  }
  return undefined;
}

describe('SarvamSTTAdapter', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends language_code=unknown when no locale provided (auto-detect)', async () => {
    const { adapter, instance } = makeAdapter();
    instance.post.mockResolvedValue({
      data: { transcript: 'hello', confidence: 0.9, language_code: 'en-IN' },
    });

    const audio = Buffer.from('fake-audio');
    await adapter.transcribe(audio);

    const formData = instance.post.mock.calls[0][1];
    expect(getFormField(formData, 'language_code')).toBe('unknown');
  });

  it('sets Transcript.locale from response.data.language_code, not from input', async () => {
    const { adapter, instance } = makeAdapter();
    instance.post.mockResolvedValue({
      data: { transcript: 'hello', confidence: 0.9, language_code: 'ta-IN' },
    });

    const result = await adapter.transcribe(Buffer.from('audio'));
    expect(result.locale).toBe('ta-IN');
  });

  it('sends provided locale when explicitly given', async () => {
    const { adapter, instance } = makeAdapter();
    instance.post.mockResolvedValue({
      data: { transcript: 'नमस्ते', confidence: 0.95, language_code: 'hi-IN' },
    });

    await adapter.transcribe(Buffer.from('audio'), 'hi-IN');
    const formData = instance.post.mock.calls[0][1];
    expect(getFormField(formData, 'language_code')).toBe('hi-IN');
  });

  it('does not fall back to hi-IN for unmapped locales', async () => {
    const { adapter, instance } = makeAdapter();
    instance.post.mockResolvedValue({
      data: { transcript: 'text', confidence: 0.8, language_code: 'en-IN' },
    });

    await adapter.transcribe(Buffer.from('audio'), 'en-IN');
    const formData = instance.post.mock.calls[0][1];
    expect(getFormField(formData, 'language_code')).toBe('en-IN');
  });

  it('falls back to locale from input when response has no language_code', async () => {
    const { adapter, instance } = makeAdapter();
    instance.post.mockResolvedValue({
      data: { transcript: 'hello', confidence: 0.8 },  // no language_code
    });

    const result = await adapter.transcribe(Buffer.from('audio'), 'en-IN');
    expect(result.locale).toBe('en-IN');
  });
});
