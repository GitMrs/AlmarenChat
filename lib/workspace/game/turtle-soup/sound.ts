'use client';

import type { TurtleSoupVerdict } from './types';

class SoundSynthesizer {
  private ctx: AudioContext | null = null;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;
    if (!this.ctx) {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /**
   * 判定钟声音效
   */
  public playVerdict(verdict: TurtleSoupVerdict) {
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;

      switch (verdict) {
        case 'YES': {
          // 清脆铜钟 (C6 -> G6)
          this.playBellTone(ctx, 1046.5, now, 0.9, 0.22);
          this.playBellTone(ctx, 1567.98, now + 0.08, 1.1, 0.18);
          break;
        }
        case 'NO': {
          // 沉闷否定木击低音 (220Hz -> 100Hz)
          this.playThudTone(ctx, 220, 95, now, 0.35, 0.28);
          this.playThudTone(ctx, 180, 80, now + 0.12, 0.4, 0.24);
          break;
        }
        case 'IRRELEVANT': {
          // 中性木鱼/水滴短音
          this.playShortPlink(ctx, 523.25, now, 0.25, 0.15);
          break;
        }
        case 'KEY_POINT': {
          // 灵光一现上升和弦 (C5 -> E5 -> G5 -> C6)
          const notes = [523.25, 659.25, 783.99, 1046.5];
          notes.forEach((freq, idx) => {
            this.playBellTone(ctx, freq, now + idx * 0.07, 0.8, 0.15);
          });
          break;
        }
        case 'SOLVED': {
          // 破案胜利大和弦 (C4 -> G4 -> C5 -> E5 -> G5 -> C6)
          const chords = [261.63, 392.0, 523.25, 659.25, 783.99, 1046.5, 1318.51];
          chords.forEach((freq, idx) => {
            this.playBellTone(ctx, freq, now + idx * 0.06, 1.8, 0.2);
          });
          break;
        }
      }
    } catch {
      // 容错降级，不阻断业务逻辑
    }
  }

  /**
   * 解锁线索锦囊音效 (清脆羊皮卷滑动音)
   */
  public playClueUnlock() {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      this.playBellTone(ctx, 880, now, 0.6, 0.15);
      this.playBellTone(ctx, 1318.51, now + 0.09, 0.8, 0.15);
    } catch {
      // ignore
    }
  }

  /**
   * 结案印章盖戳打击音效 (沉稳有力盖戳声)
   */
  public playStampThud() {
    const ctx = this.getContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // 模拟印章撞击纸张的厚重砰声 + 清脆木质手柄回弹
      this.playThudTone(ctx, 160, 45, now, 0.3, 0.35);
      this.playShortPlink(ctx, 600, now + 0.03, 0.1, 0.12);
    } catch {
      // ignore
    }
  }

  // --- 辅助物理振荡器生成器 ---

  private playBellTone(ctx: AudioContext, freq: number, startTime: number, duration: number, gainValue: number) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    // 泛音加持增强铜钟质感
    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.exponentialRampToValueAtTime(gainValue, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  private playThudTone(ctx: AudioContext, startFreq: number, endFreq: number, startTime: number, duration: number, gainValue: number) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(startFreq, startTime);
    osc.frequency.exponentialRampToValueAtTime(endFreq, startTime + duration);

    gain.gain.setValueAtTime(gainValue, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }

  private playShortPlink(ctx: AudioContext, freq: number, startTime: number, duration: number, gainValue: number) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.8, startTime + duration);

    gain.gain.setValueAtTime(gainValue, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(startTime);
    osc.stop(startTime + duration);
  }
}

export const soupAudio = new SoundSynthesizer();
