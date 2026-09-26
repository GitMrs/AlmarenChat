import { synthesizeEdgeTTS } from './edge-tts.mjs';
import { CURATED_VOICES, DEFAULT_VOICE_ID, getVoiceById, resolveSafeVoice } from './voices.mjs';
import { cleanMarkdownForTTS } from './markdown-cleaner.mjs';
import crypto from 'node:crypto';
import { mkdir, readFile, readdir, stat, unlink, utimes, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export {
  CURATED_VOICES,
  DEFAULT_VOICE_ID,
  getVoiceById,
  resolveSafeVoice,
  synthesizeEdgeTTS,
  cleanMarkdownForTTS,
  getCacheKey,
  getDiskCachePath,
  writeDiskCache,
  readDiskCache,
  diskCacheDirectory,
  DISK_CACHE_NAMESPACE,
};

// In-memory cache for recent TTS outputs (max 100 entries, 30 min TTL)
const audioCache = new Map();
const MAX_CACHE_ENTRIES = 100;
const MAX_DISK_CACHE_ENTRIES = 2000;
const CACHE_TTL_MS = 30 * 60 * 1000;
const DISK_CACHE_NAMESPACE = 'gomoku';
const diskCacheDirectory = path.resolve(process.cwd(), '.data', 'cache', 'tts', DISK_CACHE_NAMESPACE);
const pendingDiskWrites = new Map();

function getCacheKey(text, options = {}) {
  const voice = resolveSafeVoice(options.voice);
  const voiceMeta = getVoiceById(voice);
  const rate = options.rate || voiceMeta?.defaultRate || '+0%';
  const pitch = options.pitch || '+0Hz';
  return `${voice}:${rate}:${pitch}:${text.trim()}`;
}

function getDiskCachePath(cacheKey) {
  const digest = crypto.createHash('sha256').update(cacheKey).digest('hex');
  return path.join(diskCacheDirectory, `${digest}.mp3`);
}

function isDiskCacheEnabled(options = {}) {
  return options.cacheNamespace === DISK_CACHE_NAMESPACE;
}

async function readDiskCache(cacheKey) {
  const filePath = getDiskCachePath(cacheKey);
  try {
    const buffer = await readFile(filePath);
    await utimes(filePath, new Date(), new Date()).catch(() => {});
    return buffer;
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn('[TTS disk cache read failed]', error);
    return null;
  }
}

async function pruneDiskCache() {
  const entries = await readdir(diskCacheDirectory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.mp3')) continue;
    const filePath = path.join(diskCacheDirectory, entry.name);
    const fileStat = await stat(filePath).catch(() => null);
    if (fileStat) files.push({ filePath, mtimeMs: fileStat.mtimeMs });
  }
  files.sort((left, right) => right.mtimeMs - left.mtimeMs);
  await Promise.all(files.slice(MAX_DISK_CACHE_ENTRIES).map(({ filePath }) => unlink(filePath).catch(() => {})));
}

async function writeDiskCache(cacheKey, audioBuffer) {
  await mkdir(diskCacheDirectory, { recursive: true });
  const filePath = getDiskCachePath(cacheKey);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, audioBuffer, { flag: 'wx' });
  await rename(tempPath, filePath).catch(async (error) => {
    await unlink(tempPath).catch(() => {});
    if (error?.code !== 'EEXIST') throw error;
  });
  await pruneDiskCache();
}

async function persistDiskCache(cacheKey, audioBuffer) {
  if (pendingDiskWrites.has(cacheKey)) return pendingDiskWrites.get(cacheKey);
  const pending = writeDiskCache(cacheKey, audioBuffer)
    .catch((error) => console.warn('[TTS disk cache write failed]', error))
    .finally(() => pendingDiskWrites.delete(cacheKey));
  pendingDiskWrites.set(cacheKey, pending);
  return pending;
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
    const error = new Error('Text to synthesize cannot be empty');
    error.code = 'EMPTY_TEXT';
    throw error;
  }

  const voice = resolveSafeVoice(options.voice);
  const voiceMeta = getVoiceById(voice);
  const effectiveOptions = {
    ...options,
    voice,
    rate: options.rate || voiceMeta?.defaultRate || '+0%',
    pitch: options.pitch || '+0Hz',
  };

  // Check cache for short/medium phrases (< 500 chars)
  const isCacheable = cleanText.length < 500;
  const cacheKey = isCacheable ? getCacheKey(cleanText, effectiveOptions) : '';

  if (isCacheable && audioCache.has(cacheKey)) {
    const cached = audioCache.get(cacheKey);
    if (Date.now() - cached.timestamp <= CACHE_TTL_MS) {
      cached.buffer.cacheStatus = 'HIT-MEMORY';
      return cached.buffer;
    }
    audioCache.delete(cacheKey);
  }

  if (isCacheable && isDiskCacheEnabled(effectiveOptions)) {
    const diskCached = await readDiskCache(cacheKey);
    if (diskCached) {
      audioCache.set(cacheKey, { buffer: diskCached, timestamp: Date.now() });
      diskCached.cacheStatus = 'HIT-DISK';
      return diskCached;
    }
  }

  // Call Edge TTS engine
  const audioBuffer = await synthesizeEdgeTTS(cleanText, effectiveOptions);
  audioBuffer.cacheStatus = 'MISS';

  if (isCacheable && audioBuffer.length > 0) {
    pruneCache();
    audioCache.set(cacheKey, {
      buffer: audioBuffer,
      timestamp: Date.now(),
    });
    if (isDiskCacheEnabled(effectiveOptions)) await persistDiskCache(cacheKey, audioBuffer);
  }

  return audioBuffer;
}

/**
 * Returns the list of curated voices supported by the platform.
 */
export function getAvailableVoices() {
  return CURATED_VOICES;
}
