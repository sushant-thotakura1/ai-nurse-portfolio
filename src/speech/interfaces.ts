export interface Transcript {
  text: string;
  confidence: number;
  locale: string;
  timestamp: Date;
}

export interface STTProvider {
  /**
   * Transcribe audio buffer to text
   */
  transcribe(
    audio: Buffer,
    locale?: string,   // undefined = auto-detect; BCP-47 string (e.g. 'hi-IN') = use explicitly
    hints?: string[]
  ): Promise<Transcript>;

  /**
   * Stream transcription for real-time audio
   */
  streamTranscribe(
    audioStream: ReadableStream,
    locale: string
  ): AsyncIterator<Transcript>;
}

export interface VoiceOption {
  id: string;
  name: string;
  gender: 'male' | 'female';
  locale: string;
}

export interface TTSProvider {
  /**
   * Synthesize text to speech audio
   */
  synthesize(
    text: string,
    locale: string,
    voiceProfile?: string
  ): Promise<Buffer>;

  /**
   * Get available voice options for a locale
   */
  getVoiceOptions(locale: string): Promise<VoiceOption[]>;
}
