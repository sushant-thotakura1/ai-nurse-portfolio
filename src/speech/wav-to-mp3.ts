/**
 * WAV → MP3 converter using ffmpeg.
 *
 * Sarvam TTS returns PCM WAV audio. WhatsApp only accepts MP3/AAC/OGG, so we
 * re-encode to MP3 before uploading to the WhatsApp Media API.
 *
 * Uses the system ffmpeg binary (installed via `apk add ffmpeg` in Docker) so
 * there are no npm package CJS/ESM compatibility issues.
 */
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';

/**
 * Convert a WAV Buffer to an MP3 Buffer using ffmpeg.
 */
export function wavToMp3(wavBuffer: Buffer): Buffer {
  const ts = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const inputPath  = join(tmpdir(), `ainurse-${ts}.wav`);
  const outputPath = join(tmpdir(), `ainurse-${ts}.mp3`);

  try {
    writeFileSync(inputPath, wavBuffer);

    const result = spawnSync('ffmpeg', [
      '-y',                 // overwrite output without asking
      '-i', inputPath,      // input file
      '-codec:a', 'libmp3lame',
      '-qscale:a', '4',     // VBR quality ~165 kbps — good balance for voice
      outputPath,
    ], { timeout: 30_000 });

    if (result.status !== 0) {
      const errMsg = result.stderr?.toString() ?? 'unknown ffmpeg error';
      throw new Error(`ffmpeg WAV→MP3 conversion failed: ${errMsg}`);
    }

    return readFileSync(outputPath);
  } finally {
    for (const p of [inputPath, outputPath]) {
      try { unlinkSync(p); } catch { /* ignore */ }
    }
  }
}

/** Returns true if the buffer starts with a WAV RIFF header. */
export function isWav(buf: Buffer): boolean {
  return buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WAVE';
}
