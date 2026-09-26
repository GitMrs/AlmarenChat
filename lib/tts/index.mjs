import { synthesizeEdgeTTS } from './edge-tts.mjs';
import { CURATED_VOICES, DEFAULT_VOICE_ID, getVoiceById, resolveSafeVoice } from './voices.mjs';
import { cleanMarkdownForTTS } from './markdown-cleaner.mjs';

export { CURATED_VOICES, DEFAULT_VOICE_ID, getVoiceById, resolveSafeVoice, synthesizeEdgeTTS, cleanMarkdownForTTS };

// In-memory cache for recent TTS outputs (max 100 entries, 30 min TTL)
const audioCache = new Map();
const MAX_CACHE_ENTRIES = 100;
const CACHE_TTL_MS = 30 * 60 * 1000;

function getCacheKey(text, options = {}) {
  const voice = resolveSafeVoice(options.voice);
  const rate = options.rate || '+0%';
  const pitch = options.pitch || '+0Hz';
  return `${voice}:${rate}:${pitch}:${text.trim()}`;
}

function pruneCache() {
  const now = Date.now();
  for (const [key, item] of audioCache.entries()) {
    if (now - item.timestamp > CACHE_TTL_MS) {
      audioCache.delete(key);
    }
  }
  if (audioCache.size > MAX_CACHE_ENTRIES) {
    const oldestKeys = Array.from(audioCache.keys()).slice(0, audioCache.size - MAX_CACHE_ENTRIES);
    for (const key of oldestKeys) {
      audioCache.delete(key);
    }
  }
}

/**
 * Main entrance to synthesize speech from text.
 * Automatically checks memory cache before calling the underlying engine.
 */
export async function synthesizeSpeech(text, options = {}) {
  const cleanText = cleanMarkdownForTTS(text);
  if (!cleanText) {
    throw new Error('Text to synthesize cannot be empty');
  }

  // Check cache for short/medium phrases (< 500 chars)
  const isCacheable = cleanText.length < 500;
  const cacheKey = isCacheable ? getCacheKey(cleanText, options) : '';

  if (isCacheable && audioCache.has(cacheKey)) {
    const cached = audioCache.get(cacheKey);
    if (Date.now() - cached.timestamp <= CACHE_TTL_MS) {
      return cached.buffer;
    }
    audioCache.delete(cacheKey);
  }

  // Call Edge TTS engine
  const audioBuffer = await synthesizeEdgeTTS(cleanText, options);

  if (isCacheable && audioBuffer.length > 0) {
    pruneCache();
    audioCache.set(cacheKey, {
      buffer: audioBuffer,
      timestamp: Date.now(),
    });
  }

  return audioBuffer;
}

/**
 * Returns the list of curated voices supported by the platform.
 */
export function getAvailableVoices() {
  return CURATED_VOICES;
}
