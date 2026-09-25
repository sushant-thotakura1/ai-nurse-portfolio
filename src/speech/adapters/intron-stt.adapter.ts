import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import { STTProvider, Transcript } from '../interfaces';
import { logger } from '../../core/logger';
import { intronLocale } from '../intron-locales';

interface IntronSTTConfig {
  apiKey: string;
  baseUrl?: string;
  /** Poll interval when /upload/sync returns before the transcript is ready. */
  pollIntervalMs?: number;
  /** Give up polling after this long. */
  pollTimeoutMs?: number;
}

/** Detect audio format from magic bytes so we always send the correct MIME type.
 *  WhatsApp voice notes arrive as OGG/Opus — never declare them as WAV. */
function detectAudioFormat(buf: Buffer): { mimeType: string; filename: string } {
  if (buf.length >= 4 && buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) {
    return { mimeType: 'audio/ogg', filename: 'audio.ogg' };
  }
  if (buf.length >= 4 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
    return { mimeType: 'audio/wav', filename: 'audio.wav' };
  }
  if (buf.length >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    return { mimeType: 'audio/mpeg', filename: 'audio.mp3' };
  }
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
    return { mimeType: 'audio/mpeg', filename: 'audio.mp3' };
  }
  if (buf.length >= 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    return { mimeType: 'audio/mp4', filename: 'audio.m4a' };
  }
  // Default: OGG — WhatsApp voice notes are always OGG/Opus
  return { mimeType: 'audio/ogg', filename: 'audio.ogg' };
}

type Payload = Record<string, unknown>;

function unwrap(data: unknown): Payload {
  const body = (data ?? {}) as Payload;
  return ((body.data ?? body) ?? {}) as Payload;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Intron STT via the integrator "sync" endpoint.
 *
 * POST /file/v1/upload/sync  (audio <= 120s, 30 req/min)
 *   → { data: { file_id, processing_status, audio_transcript } }
 *
 * Observed against the live API (2026-09-07): the upload response usually
 * carries `audio_transcript` inline, but `processing_status` can still read
 * `FILE_QUEUED` at that point. When the transcript is not yet present we poll
 * `GET /file/v1/status/{file_id}` until it is (or `FILE_FAILED` / timeout).
 *
 * Intron does NOT auto-detect language — `use_language_asr_input` is sent when
 * the caller supplies a mapped locale, otherwise omitted (Intron defaults to
 * `en`). The API returns no detected-language field, so `Transcript.locale`
 * echoes the requested locale (or `en-NG` when none was requested).
 */
export class IntronSTTAdapter implements STTProvider {
  private readonly client: AxiosInstance;
  private readonly pollIntervalMs: number;
  private readonly pollTimeoutMs: number;

  constructor(config: IntronSTTConfig) {
    this.pollIntervalMs = config.pollIntervalMs ?? 2000;
    this.pollTimeoutMs = config.pollTimeoutMs ?? 30_000;
    this.client = axios.create({
      baseURL: config.baseUrl ?? 'https://infer.voice.intron.io',
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
  }

  async transcribe(audio: Buffer, locale?: string, _hints?: string[]): Promise<Transcript> {
    const m = intronLocale(locale);
    const audioFormat = detectAudioFormat(audio);

    logger.info('IntronSTTAdapter: uploading audio (sync)', {
      audioSize: audio.length,
      detectedFormat: audioFormat.mimeType,
      locale: locale ?? '(none)',
      sttCode: m?.sttCode ?? '(default en)',
    });

    const form = new FormData();
    form.append('audio_file_blob', audio, { filename: audioFormat.filename, contentType: audioFormat.mimeType });
    form.append('audio_file_name', audioFormat.filename);
    if (m) {
      form.append('use_language_asr_input', m.sttCode);
    }

    let payload: Payload;
    try {
      const res = await this.client.post('/file/v1/upload/sync', form, { headers: form.getHeaders() });
      payload = unwrap(res.data);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 503) {
        throw new Error('Intron STT timed out (HTTP 503 — audio exceeded the 120s processing limit)');
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Intron STT upload failed: ${msg}`);
    }

    let transcript = this.transcriptFrom(payload);
    const fileId = String(payload.file_id ?? '');

    // The upload response can return before the transcript is ready. Poll status
    // until it appears (or the job fails / we time out).
    if (transcript === null && fileId) {
      transcript = await this.pollForTranscript(fileId);
    }

    if (transcript === null) {
      throw new Error(
        `Intron STT: no transcript (status="${String(payload.processing_status ?? '')}", file_id="${fileId}")`,
      );
    }

    const resolvedLocale = locale ?? 'en-NG';
    logger.info('IntronSTTAdapter: transcription complete', { textLength: transcript.length, resolvedLocale });

    return {
      text: transcript,
      confidence: 1.0, // API returns no confidence score
      locale: resolvedLocale,
      timestamp: new Date(),
    };
  }

  /**
   * Returns the trimmed transcript string when the payload has one, `null` when
   * it is not ready yet. Throws when the job has failed.
   */
  private transcriptFrom(payload: Payload): string | null {
    const status = String(payload.processing_status ?? '');
    if (status === 'FILE_FAILED') {
      throw new Error(`Intron STT job failed: ${String(payload.error_message ?? 'unknown error')}`);
    }
    const raw = payload.audio_transcript;
    if (typeof raw === 'string' && raw.trim().length > 0) {
      return raw.trim();
    }
    return null;
  }

  private async pollForTranscript(fileId: string): Promise<string | null> {
    const deadline = Date.now() + this.pollTimeoutMs;
    while (Date.now() < deadline) {
      await sleep(this.pollIntervalMs);
      let payload: Payload;
      try {
        const res = await this.client.get(`/file/v1/status/${fileId}`);
        payload = unwrap(res.data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Intron STT status poll failed (file_id="${fileId}"): ${msg}`);
      }
      const transcript = this.transcriptFrom(payload);
      if (transcript !== null) return transcript;
    }
    throw new Error(`Intron STT timed out after ${this.pollTimeoutMs}ms waiting for transcript (file_id="${fileId}")`);
  }

  async *streamTranscribe(_audioStream: ReadableStream, _locale: string): AsyncIterator<Transcript> {
    throw new Error('Stream transcription not implemented for Intron');
  }
}
