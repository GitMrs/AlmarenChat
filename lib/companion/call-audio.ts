'use client';

/**
 * 伴侣通话音效管理器 (复用经过 CC0 许可的电话音效)
 */
export class CallSoundManager {
  private ringAudio: HTMLAudioElement | null = null;
  private connectAudio: HTMLAudioElement | null = null;
  private hangUpAudio: HTMLAudioElement | null = null;

  private getAudio(src: string): HTMLAudioElement {
    const audio = new Audio(src);
    audio.preload = 'auto';
    return audio;
  }

  playRing() {
    this.stopAll();
    try {
      if (!this.ringAudio) {
        this.ringAudio = this.getAudio('/companion/audio/sounds/ringback.mp3');
        this.ringAudio.loop = true;
      }
      this.ringAudio.currentTime = 0;
      void this.ringAudio.play().catch(e => console.warn('[CallSound] Ring blocked or failed:', e));
    } catch (e) {
      console.warn('[CallSound] Error starting ring:', e);
    }
  }

  stopRing() {
    if (this.ringAudio) {
      this.ringAudio.pause();
      this.ringAudio.currentTime = 0;
    }
  }

  playConnect() {
    this.stopRing();
    try {
      if (!this.connectAudio) {
        this.connectAudio = this.getAudio('/companion/audio/sounds/connect.ogg');
      }
      this.connectAudio.currentTime = 0;
      void this.connectAudio.play().catch(e => console.warn('[CallSound] Connect tone failed:', e));
    } catch (e) {
      console.warn('[CallSound] Error playing connect tone:', e);
    }
  }

  playHangUp() {
    this.stopRing();
    try {
      if (!this.hangUpAudio) {
        this.hangUpAudio = this.getAudio('/companion/audio/sounds/hang-up.mp3');
      }
      this.hangUpAudio.currentTime = 0;
      void this.hangUpAudio.play().catch(e => console.warn('[CallSound] HangUp tone failed:', e));
    } catch (e) {
      console.warn('[CallSound] Error playing hangup tone:', e);
    }
  }

  stopAll() {
    this.stopRing();
    if (this.connectAudio) {
      this.connectAudio.pause();
      this.connectAudio.currentTime = 0;
    }
    if (this.hangUpAudio) {
      this.hangUpAudio.pause();
      this.hangUpAudio.currentTime = 0;
    }
  }
}

/**
 * 浏览器原生语音识别 (Web Speech API) 管理器
 */
export interface VoiceRecognitionOptions {
  lang?: string;
  onInterimResult?: (transcript: string) => void;
  onFinalResult?: (transcript: string) => void;
  onError?: (error: any) => void;
  onEnd?: () => void;
}

export class VoiceRecognitionManager {
  private recognition: any = null;
  private isListening = false;
  private shouldKeepListening = false;
  private options: VoiceRecognitionOptions;

  constructor(options: VoiceRecognitionOptions = {}) {
    this.options = options;
  }

  static isSupported(): boolean {
    if (typeof window === 'undefined') return false;
    return Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }

  start() {
    if (typeof window === 'undefined') return;
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.options.onError?.(new Error('当前浏览器不支持 Web Speech 语音识别'));
      return;
    }

    if (this.recognition && this.isListening) return;

    try {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = this.options.lang || 'zh-CN';

      this.recognition.onstart = () => {
        this.isListening = true;
      };

      this.recognition.onresult = (event: any) => {
        let interim = '';
        let final = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            final += transcript;
          } else {
            interim += transcript;
          }
        }

        if (interim) {
          this.options.onInterimResult?.(interim);
        }
        if (final && final.trim()) {
          this.options.onFinalResult?.(final.trim());
        }
      };

      this.recognition.onerror = (event: any) => {
        // 'no-speech' is normal when user is just listening
        if (event.error !== 'no-speech') {
          console.warn('[VoiceRecognition] Speech error:', event.error);
          this.options.onError?.(event);
        }
      };

      this.recognition.onend = () => {
        this.isListening = false;
        if (this.shouldKeepListening) {
          try {
            this.recognition?.start();
          } catch {
            // ignore restart errors
          }
        } else {
          this.options.onEnd?.();
        }
      };

      this.shouldKeepListening = true;
      this.recognition.start();
    } catch (e) {
      console.warn('[VoiceRecognition] Failed to start recognition:', e);
      this.options.onError?.(e);
    }
  }

  stop() {
    this.shouldKeepListening = false;
    this.isListening = false;
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // ignore
      }
      this.recognition = null;
    }
  }

  destroy() {
    this.stop();
    this.recognition = null;
  }
}
