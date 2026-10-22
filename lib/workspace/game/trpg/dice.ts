/**
 * TRPG 命运骰子核心算法与检定引擎
 * 支持 D4, D6, D8, D10, D12, D20, D100
 * 支持克苏鲁 (COC) 百分骰规则与龙与地下城 (D&D) D20 规则
 */

export type DiceType = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20' | 'd100';

export interface DiceRollResult {
  diceType: DiceType;
  sides: number;
  roll: number;
  modifier: number;
  total: number;
  timestamp: number;
}

export type CheckLevel =
  | 'critical_success' // 大成功 / 天然 20
  | 'extreme_success'  // 极难成功 (COC <= 1/5)
  | 'hard_success'     // 困难成功 (COC <= 1/2)
  | 'success'          // 常规成功
  | 'failure'          // 失败
  | 'fumble';          // 大失败 / 致命失误 (COC >= 96 或 DND 天然 1)

export interface SkillCheckResult {
  rule: 'coc' | 'dnd';
  skillName: string;
  diceRoll: DiceRollResult;
  targetValue: number; // COC 中为技能值 (1-100)，DND 中为 DC 难度目标值
  modifier: number;
  level: CheckLevel;
  isSuccess: boolean;
  summary: string;
  detail: string;
}

/**
 * 掷单个骰子
 */
export function rollSingleDie(sides: number): number {
  if (sides <= 1) return 1;
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * 掷特定类型的骰子
 */
export function rollDice(type: DiceType, modifier = 0): DiceRollResult {
  const sidesMap: Record<DiceType, number> = {
    d4: 4,
    d6: 6,
    d8: 8,
    d10: 10,
    d12: 12,
    d20: 20,
    d100: 100,
  };

  const sides = sidesMap[type] || 20;
  const roll = rollSingleDie(sides);
  return {
    diceType: type,
    sides,
    roll,
    modifier,
    total: roll + modifier,
    timestamp: Date.now(),
  };
}

/**
 * 进行克苏鲁神话 (COC 7th) 百分骰检定
 * 规则：
 * 掷 1d100
 * - 01 永远是大成功 (Critical Success)
 * - 02~05 当技能 >= 50 时为大成功
 * - <= 技能值 / 5: 极难成功 (Extreme Success)
 * - <= 技能值 / 2: 困难成功 (Hard Success)
 * - <= 技能值: 常规成功 (Regular Success)
 * - 技能 < 50 时，96~100 为大失败 (Fumble)
 * - 技能 >= 50 时，100 为大失败
 * - 其他为失败 (Failure)
 */
export function evaluateCocCheck(
  skillName: string,
  targetSkillValue: number,
  forcedRoll?: number
): SkillCheckResult {
  const roll = forcedRoll !== undefined ? forcedRoll : rollSingleDie(100);
  const diceRoll: DiceRollResult = {
    diceType: 'd100',
    sides: 100,
    roll,
    modifier: 0,
    total: roll,
    timestamp: Date.now(),
  };

  const extremeThreshold = Math.floor(targetSkillValue / 5);
  const hardThreshold = Math.floor(targetSkillValue / 2);

  let level: CheckLevel;
  let isSuccess = false;

  // 大失败判断
  const isFumble = targetSkillValue < 50 ? roll >= 96 : roll === 100;

  // 大成功判断
  const isCrit = roll === 1 || (targetSkillValue >= 50 && roll <= 5);

  if (isCrit) {
    level = 'critical_success';
    isSuccess = true;
  } else if (isFumble) {
    level = 'fumble';
    isSuccess = false;
  } else if (roll <= extremeThreshold) {
    level = 'extreme_success';
    isSuccess = true;
  } else if (roll <= hardThreshold) {
    level = 'hard_success';
    isSuccess = true;
  } else if (roll <= targetSkillValue) {
    level = 'success';
    isSuccess = true;
  } else {
    level = 'failure';
    isSuccess = false;
  }

  const levelLabels: Record<CheckLevel, string> = {
    critical_success: '🌟 绝世大成功！',
    extreme_success: '✨ 极难成功！',
    hard_success: '🎯 困难成功！',
    success: '✅ 成功！',
    failure: '❌ 检定失败',
    fumble: '💀 绝望大失败！',
  };

  const summary = `【${skillName}】检定：1d100 = ${roll} / ${targetSkillValue} → ${levelLabels[level]}`;
  const detail = `技能值 ${targetSkillValue} (极难 ≤ ${extremeThreshold}，困难 ≤ ${hardThreshold})，掷出 ${roll} 点`;

  return {
    rule: 'coc',
    skillName,
    diceRoll,
    targetValue: targetSkillValue,
    modifier: 0,
    level,
    isSuccess,
    summary,
    detail,
  };
}

/**
 * 进行龙与地下城 (D&D 5e) 1d20 DC 检定
 * 规则：
 * 掷 1d20 + 调整值 vs 目标难度 DC
 * - 掷出 20：天然 20 (Natural 20) 绝世大成功
 * - 掷出 1：天然 1 (Natural 1) 绝望大失败
 * - Total >= DC：成功
 * - Total < DC：失败
 */
export function evaluateDndCheck(
  skillName: string,
  dc: number,
  modifier = 0,
  forcedRoll?: number
): SkillCheckResult {
  const roll = forcedRoll !== undefined ? forcedRoll : rollSingleDie(20);
  const total = roll + modifier;
  const diceRoll: DiceRollResult = {
    diceType: 'd20',
    sides: 20,
    roll,
    modifier,
    total,
    timestamp: Date.now(),
  };

  let level: CheckLevel;
  let isSuccess = false;

  if (roll === 20) {
    level = 'critical_success';
    isSuccess = true;
  } else if (roll === 1) {
    level = 'fumble';
    isSuccess = false;
  } else if (total >= dc + 5) {
    level = 'extreme_success'; // 远超难度要求
    isSuccess = true;
  } else if (total >= dc) {
    level = 'success';
    isSuccess = true;
  } else {
    level = 'failure';
    isSuccess = false;
  }

  const levelLabels: Record<CheckLevel, string> = {
    critical_success: '🌟 天然 20！绝世大成功！',
    extreme_success: '✨ 碾压通过！',
    hard_success: '🎯 顺利通过！',
    success: '✅ 检定通过！',
    failure: '❌ 检定未通过',
    fumble: '💀 天然 1！致命大失败！',
  };

  const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
  const summary = `【${skillName}】检定：1d20(${roll})${modStr} = ${total} vs DC ${dc} → ${levelLabels[level]}`;
  const detail = `目标难度 DC ${dc}，骰面 ${roll}${modStr} = 总计 ${total}`;

  return {
    rule: 'dnd',
    skillName,
    diceRoll,
    targetValue: dc,
    modifier,
    level,
    isSuccess,
    summary,
    detail,
  };
}

/**
 * 基于原生 Web Audio API 播放清脆的拟真骰子碰撞/滚动音效
 * 无需外部网络 mp3 文件，毫秒级响应
 */
export function playDiceRollSound() {
  if (typeof window === 'undefined') return;
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    // 模拟多次骰子在木盒/桌面弹跳的清脆敲击声
    const bounces = [0, 0.08, 0.17, 0.25, 0.32, 0.38];
    const now = ctx.currentTime;

    bounces.forEach((delay, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // 音调逐渐升高，模拟碰撞减速
      const baseFreq = 300 + idx * 80 + Math.random() * 60;
      osc.type = idx % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(baseFreq, now + delay);
      osc.frequency.exponentialRampToValueAtTime(100, now + delay + 0.05);

      const peakVolume = 0.15 / (idx * 0.4 + 1);
      gain.gain.setValueAtTime(0, now + delay);
      gain.gain.linearRampToValueAtTime(peakVolume, now + delay + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + delay);
      osc.stop(now + delay + 0.06);
    });

    // 0.5s 后释放音频上下文
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 600);
  } catch {
    // 忽略音频环境不可用时的错误
  }
}

/**
 * 判定结果特效音（大成功炫酷提示音 / 失败低沉音）
 */
export function playCheckResultSound(level: CheckLevel) {
  if (typeof window === 'undefined') return;
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    if (level === 'critical_success' || level === 'extreme_success') {
      // 欢快上扬琶音 (大成功)
      const freqs = [523.25, 659.25, 783.99, 1046.5]; // C5 - E5 - G5 - C6
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(f, now + i * 0.08);

        gain.gain.setValueAtTime(0.12, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.3);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.35);
      });
    } else if (level === 'fumble') {
      // 低沉警报音 (大失败)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.linearRampToValueAtTime(70, now + 0.4);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.5);
    }

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 700);
  } catch {
    // 忽略
  }
}

/**
 * 道具使用 / 治疗恢复特效音（清脆治愈铃音）
 */
export function playItemUseSound() {
  if (typeof window === 'undefined') return;
  try {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    [659.25, 987.77].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + i * 0.1);

      gain.gain.setValueAtTime(0.12, now + i * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.1);
      osc.stop(now + i * 0.1 + 0.4);
    });

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 600);
  } catch {
    // 忽略
  }
}

