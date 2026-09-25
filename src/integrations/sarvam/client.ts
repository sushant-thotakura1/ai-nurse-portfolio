/**
 * Sarvam AI Integration Client
 * Provides STT (Saaras), TTS (Bulbul), and Translation (Mayura) services
 */

import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import { config } from '../../core/config';
import { logger } from '../../core/logger';

interface SarvamSTTResponse {
  transcript: string;
  language_code?: string;
}

interface SarvamTTSResponse {
  audios: string[]; // Base64 encoded audio
}

interface SarvamTranslationResponse {
  translated_text: string;
  source_language_code: string;
  target_language_code: string;
}

export class SarvamClient {
  private client: AxiosInstance;
  private apiKey: string;

  constructor() {
    this.apiKey = config.providers.sarvam.apiKey;

    this.client = axios.create({
      baseURL: 'https://api.sarvam.ai',
      headers: {
        'api-subscription-key': this.apiKey,
      },
      timeout: 30000,
    });
  }

  /**
   * Speech-to-Text using Sarvam Saaras API
   * @param audioBuffer - Audio file buffer (WAV, MP3, etc.)
   * @param languageCode - Language code (hi-IN, te-IN, etc.)
   */
  async speechToText(
    audioBuffer: Buffer,
    languageCode: string = 'hi-IN'
  ): Promise<SarvamSTTResponse> {
    try {
      const formData = new FormData();
      formData.append('file', audioBuffer, {
        filename: 'audio.wav',
        contentType: 'audio/wav',
      });
      formData.append('model', 'saaras:v3');
      formData.append('mode', 'transcribe');
      formData.append('language_code', languageCode);

      logger.info('Calling Sarvam STT API', { languageCode });

      const response = await this.client.post<SarvamSTTResponse>(
        '/speech-to-text',
        formData,
        {
          headers: {
            ...formData.getHeaders(),
          },
        }
      );

      logger.info('Sarvam STT successful', {
        transcriptLength: response.data.transcript?.length,
      });

      return response.data;
    } catch (error: any) {
      logger.error('Sarvam STT failed', {
        error: error.message,
        response: error.response?.data,
      });
      throw new Error(`Speech-to-text failed: ${error.message}`);
    }
  }

  /**
   * Text-to-Speech using Sarvam Bulbul API
   * @param text - Text to convert to speech
   * @param languageCode - Language code (hi-IN, te-IN, etc.)
   * @param speaker - Voice speaker (simran, kavya, etc.)
   */
  async textToSpeech(
    text: string,
    languageCode: string = 'hi-IN',
    speaker: string = 'simran'
  ): Promise<Buffer> {
    try {
      logger.info('Calling Sarvam TTS API', {
        textLength: text.length,
        languageCode,
        speaker,
      });

      const response = await this.client.post<SarvamTTSResponse>(
        '/text-to-speech',
        {
          text: text,
          target_language_code: languageCode,
          speaker: speaker,
          model: 'bulbul:v3',
          pace: 1.0,
          speech_sample_rate: 8000,
        }
      );

      if (!response.data.audios || response.data.audios.length === 0) {
        throw new Error('No audio data received from TTS API');
      }

      // Decode base64 audio to buffer
      const audioBase64 = response.data.audios[0];
      const audioBuffer = Buffer.from(audioBase64, 'base64');

      logger.info('Sarvam TTS successful', {
        audioSize: audioBuffer.length,
      });

      return audioBuffer;
    } catch (error: any) {
      logger.error('Sarvam TTS failed', {
        error: error.message,
        response: error.response?.data,
      });
      throw new Error(`Text-to-speech failed: ${error.message}`);
    }
  }

  /**
   * Translate text using Sarvam Mayura API
   * @param text - Text to translate
   * @param sourceLanguage - Source language code (hi-IN, en-IN, etc.)
   * @param targetLanguage - Target language code
   */
  async translate(
    text: string,
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<string> {
    try {
      logger.info('Calling Sarvam Translation API', {
        textLength: text.length,
        sourceLanguage,
        targetLanguage,
      });

      const response = await this.client.post<SarvamTranslationResponse>(
        '/translate',
        {
          input: text,
          source_language_code: sourceLanguage,
          target_language_code: targetLanguage,
          speaker_gender: 'Female',
          mode: 'formal',
          model: 'mayura:v1',
          enable_preprocessing: true,
        }
      );

      logger.info('Sarvam Translation successful');

      return response.data.translated_text;
    } catch (error: any) {
      logger.error('Sarvam Translation failed', {
        error: error.message,
        response: error.response?.data,
      });
      throw new Error(`Translation failed: ${error.message}`);
    }
  }

  /**
   * Get supported languages for TTS
   */
  getSupportedLanguages(): string[] {
    return [
      'hi-IN', // Hindi
      'te-IN', // Telugu
      'ta-IN', // Tamil
      'kn-IN', // Kannada
      'ml-IN', // Malayalam
      'mr-IN', // Marathi
      'bn-IN', // Bengali
      'gu-IN', // Gujarati
      'pa-IN', // Punjabi
      'or-IN', // Odia
    ];
  }

  /**
   * Get supported voice speakers (Updated for Bulbul v3 - from API response)
   */
  getSupportedSpeakers(): { [key: string]: string[] } {
    return {
      female: ['ritu', 'priya', 'neha', 'pooja', 'simran', 'kavya', 'ishita', 'shreya', 'roopa', 'tanya', 'shruti', 'suhani', 'kavitha', 'amelia', 'sophia', 'rupali'],
      male: ['aditya', 'ashutosh', 'rahul', 'rohan', 'amit', 'dev', 'ratan', 'varun', 'manan', 'sumit', 'kabir', 'aayan', 'shubh', 'advait', 'anand', 'tarun', 'sunny', 'mani', 'gokul', 'vijay', 'mohit', 'rehan', 'soham'],
    };
  }
}

export const sarvamClient = new SarvamClient();
