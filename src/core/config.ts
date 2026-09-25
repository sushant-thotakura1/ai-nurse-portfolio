export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',

  database: {
    url: process.env.DATABASE_URL || '',
  },

  cache: {
    // In-memory cache TTLs (seconds)
    languagePackTTL: 3600, // 1 hour
    providerConfigTTL: 600, // 10 minutes
  },

  aws: {
    region: process.env.AWS_REGION || 'ap-south-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },

  providers: {
    exotel: {
      apiKey: process.env.EXOTEL_API_KEY || '',
      apiToken: process.env.EXOTEL_API_TOKEN || '',
      sid: process.env.EXOTEL_SID || '',
    },
    sarvam: {
      apiKey: process.env.SARVAM_API_KEY || '',
    },
    intron: {
      apiKey: process.env.INTRON_API_KEY || '',
    },
    openai: {
      apiKey: process.env.OPENAI_API_KEY || '',
    },
    stt: {
      whisperBaseUrl: process.env.STT_WHISPER_BASE_URL ?? 'http://speaches:8000/v1',
      whisperModel: process.env.STT_WHISPER_MODEL ?? 'Systran/faster-whisper-large-v3',
      defaultProvider: process.env.STT_DEFAULT_PROVIDER ?? 'sarvam',
    },
    tts: {
      edgeBaseUrl: process.env.TTS_EDGE_BASE_URL ?? 'http://edge-tts:8000/v1',
      defaultProvider: process.env.TTS_DEFAULT_PROVIDER ?? 'sarvam',
    },
  },

  security: {
    jwtSecret: process.env.JWT_SECRET || '',
    encryptionKey: process.env.ENCRYPTION_KEY || '',
  },
};
