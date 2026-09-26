export interface TTSVoice {
  id: string;
  name: string;
  gender: 'Female' | 'Male';
  locale: string;
  description: string;
  tags: string[];
  isDefault?: boolean;
  defaultRate?: string;
}

export interface TTSOptions {
  voice?: string;
  rate?: string; // e.g. '+0%', '+10%', '-10%'
  pitch?: string; // e.g. '+0Hz', '+5Hz'
  volume?: string; // e.g. '+0%'
  timeoutMs?: number;
  cacheNamespace?: 'gomoku';
}

export interface TTSResult {
  audio: Buffer;
  contentType: string;
}
