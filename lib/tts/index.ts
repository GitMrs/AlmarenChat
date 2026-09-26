import {
  CURATED_VOICES as CURATED_VOICES_IMPL,
  DEFAULT_VOICE_ID,
  getAvailableVoices as getAvailableVoicesImpl,
  getVoiceById as getVoiceByIdImpl,
  synthesizeSpeech as synthesizeSpeechImpl,
} from './index.mjs';
import type { TTSOptions, TTSVoice } from './types';

export * from './types';
export * from './markdown-cleaner';
export { DEFAULT_VOICE_ID };

export const CURATED_VOICES: TTSVoice[] = CURATED_VOICES_IMPL as unknown as TTSVoice[];
export const getAvailableVoices: () => TTSVoice[] = getAvailableVoicesImpl as unknown as () => TTSVoice[];
export const getVoiceById: (voiceId?: string) => TTSVoice = getVoiceByIdImpl as unknown as (voiceId?: string) => TTSVoice;
export const synthesizeSpeech: (text: string, options?: TTSOptions) => Promise<Buffer> = synthesizeSpeechImpl;
