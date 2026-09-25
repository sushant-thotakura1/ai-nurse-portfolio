# STT / TTS Provider Research — Voice & WhatsApp Audio

**Date:** 2026-04-03
**Branch:** voice-provider-updates
**Context:** Evaluating speech providers ahead of implementing WhatsApp voice note support and expanding language coverage beyond Indian languages.

---

## Current State

The codebase has two parallel Sarvam implementations:

| Component | Provider | Used by |
|---|---|---|
| `SarvamSTTAdapter` | Sarvam `saarika:v1` | General STT interface |
| `SarvamTTSAdapter` | Sarvam `bulbul:v3` | General TTS interface |
| `SarvamClient` | Sarvam `saaras:v3` | Test conversation service (direct) |

The `openai` npm package is installed but only used for LLM (`gpt-4o-mini`). No Whisper STT integration exists.

**WhatsApp voice notes are silently dropped** — `parseWebhook()` returns `null` for `message.type === 'audio'`, so voice messages go unanswered.

---

## OpenAI Whisper

### Hosted API (`whisper-1`)
- Uses **Whisper large-v2** — no model tier selection on the hosted API
- Pricing: **$0.006/min** (same as Sarvam STT at current INR/USD rates)
- File size limit: 25 MB (WhatsApp voice notes are ~80–200 KB — never an issue)
- Supports OGG natively; transcoding to mono 16 kHz WAV/MP3 via `fluent-ffmpeg` reduces latency
- Newer alternatives: `gpt-4o-transcribe` ($0.006/min), `gpt-4o-mini-transcribe` ($0.003/min) — marginally better on accented speech

### Integration with existing `openai` SDK
```typescript
import OpenAI, { toFile } from 'openai';

const transcription = await openai.audio.transcriptions.create({
  file: await toFile(audioBuffer, 'voice.ogg'),
  model: 'whisper-1',
  language: 'en',   // ISO-639-1 — improves accuracy and reduces latency
});
// transcription.text → transcript string
```

### Local / Self-hosted Options
| Option | Language | GPU needed | Node.js native | Notes |
|---|---|---|---|---|
| `openai-whisper` | Python | Strongly yes | No — Python sidecar | Reference implementation |
| `faster-whisper` | Python | No (CPU works) | No — Python sidecar | 4x faster than above |
| `nodejs-whisper` | C++ bindings | No | Yes (native addon) | Writes to temp file; larger Docker image |
| `fedirz/faster-whisper-server` | Python container | No | Via HTTP (OpenAI-compatible) | Cleanest local option — zero Node.js code changes |

**Recommendation:** Start with hosted `whisper-1`. For local fallback later, `fedirz/faster-whisper-server` as a Docker Compose sidecar requires only a `baseURL` change in the client — no code changes.

### Whisper is STT only
OpenAI TTS (`openai.audio.speech.create()`) is a separate API. It supports 57 languages but Indian language quality is inconsistent. Sarvam TTS remains the right choice for Indian languages.

---

## Anthropic / Claude — No Audio API

Claude launched consumer voice mode (iOS/Android, May 2025) but it is a product feature, not a developer API. There is no `transcriptions` or `speech` endpoint in the Anthropic API. For voice, the pattern is: **separate STT → Claude LLM → separate TTS**.

---

## Provider Comparison Matrix

### STT

| Provider | Indian languages | African languages | Price/min | Node.js SDK |
|---|---|---|---|---|
| **Sarvam (Saaras v3)** | ✅ Best (22 languages) | ❌ None | ~$0.006 | REST only |
| **Whisper / GPT-4o** | ⚠️ Decent | ⚠️ Varies widely | $0.003–0.006 | `openai` package |
| **Deepgram Nova-3** | ⚠️ Hindi/7 of 9 | ⚠️ Partial | $0.0043 batch | `@deepgram/sdk` |
| **Google STT v2** | ✅ Good (all 9) | ✅ 125+ languages | $0.016 std | `@google-cloud/speech` |
| **Azure Speech** | ✅ Good (all 9) | ✅ 147+ languages | $0.006 batch | `microsoft-cognitiveservices-speech-sdk` |
| **ElevenLabs Scribe v2** | ✅ Good | ✅ Good (Swahili, Zulu, Hausa) | ~$0.07/hr | `elevenlabs` |
| **Intron (Sahara)** | ❌ | ✅ Best for Africa | Not public | REST |

### TTS

| Provider | Indian languages | African languages | Price/1M chars | Notes |
|---|---|---|---|---|
| **Sarvam (Bulbul v3)** | ✅ Best (10 + 35 voices) | ❌ None | ~$3.60 | Purpose-built |
| **Azure Neural TTS** | ✅ All 9 | ⚠️ Afrikaans, Amharic, Swahili, Zulu | $16 | Widest global catalog |
| **Google Cloud TTS** | ✅ All 9 | ⚠️ Swahili, Afrikaans only | $4–16 | |
| **ElevenLabs** | ✅ 11 Indian | ⚠️ Swahili, Zulu, Hausa, Fulah | $60–170 | Best naturalness, most expensive |
| **OpenAI TTS** | ⚠️ English-centric | ❌ | $15–30 | Poor for Indian/African |
| **Intron Sahara-TTS** | ❌ | ✅ 40+ African accents | Not public | Best for Africa |
| **Abena AI** | ❌ | ✅ Yoruba, Hausa, Twi, Swahili | Not public | On-device capable |

---

## African Language Coverage — Whisper Reality Check

Whisper's training corpus has only a few hundred hours of African language audio combined. Results vary dramatically:

| Language | Speakers | Whisper quality | Best alternative |
|---|---|---|---|
| Afrikaans | 15M | ✅ Excellent (~2-3% WER) | Azure/Google TTS |
| Swahili | 200M total | ✅ Good (~11-17% WER) | Intron, Microsoft Paza |
| Hausa | 100M total | ⚠️ Moderate (~10-20% WER) | Intron, Abena AI |
| Zulu | 12M | ❌ Poor | Lelapa AI |
| Xhosa | 8M | ❌ Poor | Lelapa AI |
| Amharic | 30M | ❌ Poor (~37%+ WER) | Fine-tuned research models |
| Yoruba | 45M | ❌ Very poor (~81% WER) | Intron, Abena AI |
| Igbo | 35M | ❌ Unsupported | Intron, Abena AI |
| Somali | 22M | ❌ Unsupported | Microsoft Paza (self-hosted) |
| Oromo | 40M | ❌ Not supported | Research only |

**African-specialized providers to watch:**
- **Intron** (intron.io) — Nigeria-based, closest equivalent to Sarvam for Africa. Medical deployment validated. STT + TTS.
- **Lelapa AI** (lelapa.ai) — South Africa, Zulu/Xhosa/Afrikaans focus
- **Abena AI** (abena.mobobi.com) — West Africa, Yoruba/Hausa/Twi, on-device capable
- **Microsoft Paza** — Research fine-tune of Whisper for 6 Kenyan languages (self-hostable via HuggingFace)

---

## Recommended Target Architecture

```
STT Provider Selection (by locale)
  ├── Indian locales (hi-IN, te-IN, ta-IN, kn-IN, ml-IN, mr-IN, gu-IN, bn-IN, pa-IN)
  │     └── Sarvam Saaras v3            (best quality, cheapest, purpose-built)
  ├── Afrikaans, Swahili, Hausa
  │     └── Whisper / GPT-4o Transcribe  (acceptable quality)
  ├── Yoruba, Igbo, Zulu, Xhosa
  │     └── Intron / Lelapa AI / Abena AI (Whisper too poor)
  └── Everything else
        └── Whisper / GPT-4o Transcribe  (99-language fallback)

TTS Provider Selection (by locale)
  ├── Indian locales
  │     └── Sarvam Bulbul v3             (best quality, cheapest)
  ├── Afrikaans, Swahili, Zulu, Amharic
  │     └── Azure Neural TTS
  ├── Yoruba, Hausa, Twi
  │     └── Abena AI / Intron
  └── Non-Indian, non-African
        └── OpenAI TTS or Azure Neural TTS
```

The existing `STTProvider` / `TTSProvider` interfaces in `src/speech/interfaces.ts` already support this pattern — adding new adapters and a provider selector is a clean, additive change.

---

## WhatsApp Voice Note Flow (Planned)

```
User sends voice note
        │
        ▼
WhatsApp webhook → message.type === 'audio'
        │
        ▼
Download media from Graph API
  GET /{media-id} → { url }
  GET {url} (Bearer token) → OGG/Opus bytes (~80-200 KB)
        │
        ▼
(Optional) Transcode OGG → mono 16kHz WAV via fluent-ffmpeg
        │
        ▼
STTProviderSelector.transcribe(buffer, session.locale)
  → routes to Sarvam / Whisper / specialist based on locale
        │
        ▼
InboundMessage { text: transcript }
        │
        ▼
MessagingOrchestrator (unchanged — receives text like a normal message)
        │
        ▼
LLM response → text reply back to user
```

**Out of scope (for now):** Voice replies on WhatsApp (requires Graph API media upload + TTS pipeline).

---

## Immediate Next Step

Implement WhatsApp voice note support using `whisper-1` (hosted) as the STT provider:

1. `WhisperSTTAdapter` — implements `STTProvider` interface via `openai.audio.transcriptions.create()`
2. WhatsApp adapter — handle `type: 'audio'`, download media from Graph API, transcribe, return `InboundMessage`
3. Provider selector — route by locale (Sarvam for Indian, Whisper for everything else)
