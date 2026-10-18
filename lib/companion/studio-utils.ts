import { sampleCurve, type CompanionMotion } from './motion';

export interface StudioKeyframe {
  id: string;
  time: number;
  values: Record<string, number>;
}

export interface StudioParameterDef {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
}

export interface StudioParamGroup {
  id: string;
  label: string;
  emoji: string;
  params: StudioParameterDef[];
}

export const COMMON_STUDIO_GROUPS: Record<'nari' | 'yume', StudioParamGroup[]> = {
  nari: [
    {
      id: 'head',
      label: '头部角度',
      emoji: '👤',
      params: [
        { id: 'ParamAngleX', label: '头部左右偏转 (Yaw)', min: -30, max: 30, step: 0.5, default: 0, unit: '°' },
        { id: 'ParamAngleY', label: '头部上下俯仰 (Pitch)', min: -30, max: 30, step: 0.5, default: 0, unit: '°' },
        { id: 'ParamAngleZ', label: '头部歪头倾斜 (Roll)', min: -30, max: 30, step: 0.5, default: 0, unit: '°' },
      ],
    },
    {
      id: 'body',
      label: '身体姿态',
      emoji: '🧍',
      params: [
        { id: 'ParamBodyAngleX', label: '身体左右旋转', min: -10, max: 10, step: 0.2, default: 0, unit: '°' },
        { id: 'ParamBodyAngleY', label: '身体前后俯仰', min: -10, max: 10, step: 0.2, default: 0, unit: '°' },
        { id: 'ParamBodyAngleZ', label: '身体左右摇摆', min: -10, max: 10, step: 0.2, default: 0, unit: '°' },
        { id: 'ParamBreath', label: '呼吸起伏深度', min: 0, max: 1, step: 0.05, default: 0 },
      ],
    },
    {
      id: 'eyes',
      label: '眼神视线',
      emoji: '👀',
      params: [
        { id: 'ParamEyeBallX', label: '眼球左右聚焦', min: -1, max: 1, step: 0.05, default: 0 },
        { id: 'ParamEyeBallY', label: '眼球上下聚焦', min: -1, max: 1, step: 0.05, default: 0 },
        { id: 'ParamEyeLOpen', label: '左眼睁开度', min: 0, max: 1.5, step: 0.05, default: 1 },
        { id: 'ParamEyeROpen', label: '右眼睁开度', min: 0, max: 1.5, step: 0.05, default: 1 },
        { id: 'ParamEyeLSmile', label: '左眼月牙微笑', min: 0, max: 1, step: 0.05, default: 0 },
        { id: 'ParamEyeRSmile', label: '右眼月牙微笑', min: 0, max: 1, step: 0.05, default: 0 },
      ],
    },
    {
      id: 'mouth',
      label: '嘴型眉毛',
      emoji: '👄',
      params: [
        { id: 'ParamMouthOpenY', label: '嘴巴张开程度', min: 0, max: 1, step: 0.05, default: 0 },
        { id: 'ParamMouthForm', label: '嘴角微笑上扬', min: -1, max: 1, step: 0.05, default: 0 },
        { id: 'ParamBrowLAngle', label: '左眉角度倾斜', min: -1, max: 1, step: 0.05, default: 0 },
        { id: 'ParamBrowRAngle', label: '右眉角度倾斜', min: -1, max: 1, step: 0.05, default: 0 },
        { id: 'ParamBrowLForm', label: '左眉形态变形', min: -1, max: 1, step: 0.05, default: 0 },
        { id: 'ParamBrowRForm', label: '右眉形态变形', min: -1, max: 1, step: 0.05, default: 0 },
      ],
    },
    {
      id: 'emotions',
      label: '情绪贴纸',
      emoji: '🌸',
      params: [
        { id: 'Param31', label: '少女脸红害羞', min: 0, max: 1, step: 0.1, default: 0 },
        { id: 'Param27', label: '惊讶目瞪口呆', min: 0, max: 1, step: 0.1, default: 0 },
        { id: 'Param28', label: '闪亮星星眼', min: 0, max: 1, step: 0.1, default: 0 },
        { id: 'Param32', label: '心动爱心眼', min: 0, max: 1, step: 0.1, default: 0 },
        { id: 'Param30', label: '委屈流泪', min: 0, max: 1, step: 0.1, default: 0 },
        { id: 'Param29', label: '鼓脸生气', min: 0, max: 1, step: 0.1, default: 0 },
      ],
    },
  ],
  yume: [
    {
      id: 'head',
      label: '头部角度',
      emoji: '👤',
      params: [
        { id: 'ParamAngleX', label: '头部左右偏转 (Yaw)', min: -30, max: 30, step: 0.5, default: 0, unit: '°' },
        { id: 'ParamAngleY', label: '头部上下俯仰 (Pitch)', min: -30, max: 30, step: 0.5, default: 0, unit: '°' },
        { id: 'ParamAngleZ', label: '头部歪头倾斜 (Roll)', min: -30, max: 30, step: 0.5, default: 0, unit: '°' },
      ],
    },
    {
      id: 'body',
      label: '身体姿态',
      emoji: '🧍',
      params: [
        { id: 'ParamBodyAngleX', label: '身体左右旋转', min: -10, max: 10, step: 0.2, default: 0, unit: '°' },
        { id: 'ParamBodyAngleY', label: '身体前后俯仰', min: -10, max: 10, step: 0.2, default: 0, unit: '°' },
        { id: 'ParamBodyAngleZ', label: '身体左右摇摆', min: -10, max: 10, step: 0.2, default: 0, unit: '°' },
        { id: 'ParamBreath', label: '呼吸起伏深度', min: 0, max: 1, step: 0.05, default: 0 },
      ],
    },
    {
      id: 'eyes',
      label: '眼神视线',
      emoji: '👀',
      params: [
        { id: 'ParamEyeBallX', label: '眼球左右聚焦', min: -1, max: 1, step: 0.05, default: 0 },
        { id: 'ParamEyeBallY', label: '眼球上下聚焦', min: -1, max: 1, step: 0.05, default: 0 },
        { id: 'ParamEyeLOpen', label: '左眼睁开度', min: 0, max: 1.5, step: 0.05, default: 1 },
        { id: 'ParamEyeROpen', label: '右眼睁开度', min: 0, max: 1.5, step: 0.05, default: 1 },
        { id: 'ParamEyeLSmile', label: '左眼月牙微笑', min: 0, max: 1, step: 0.05, default: 0 },
        { id: 'ParamEyeRSmile', label: '右眼月牙微笑', min: 0, max: 1, step: 0.05, default: 0 },
      ],
    },
    {
      id: 'mouth',
      label: '嘴型眉毛',
      emoji: '👄',
      params: [
        { id: 'ParamMouthOpenY', label: '嘴巴张开程度', min: 0, max: 1, step: 0.05, default: 0 },
        { id: 'ParamMouthForm', label: '嘴角微笑上扬', min: -1, max: 1, step: 0.05, default: 0 },
        { id: 'ParamBrowLAngle', label: '左眉角度倾斜', min: -1, max: 1, step: 0.05, default: 0 },
        { id: 'ParamBrowRAngle', label: '右眉角度倾斜', min: -1, max: 1, step: 0.05, default: 0 },
      ],
    },
    {
      id: 'emotions',
      label: '情绪贴纸',
      emoji: '🌊',
      params: [
        { id: 'ParamBlush', label: '脸红害羞', min: 0, max: 1, step: 0.1, default: 0 },
        { id: 'ParamShock', label: '震惊目瞪口呆', min: 0, max: 1, step: 0.1, default: 0 },
        { id: 'ParamStar', label: '闪亮星星眼', min: 0, max: 1, step: 0.1, default: 0 },
        { id: 'ParamHeart', label: '心动爱心眼', min: 0, max: 1, step: 0.1, default: 0 },
        { id: 'ParamTear', label: '委屈流泪', min: 0, max: 1, step: 0.1, default: 0 },
      ],
    },
  ],
};

/**
 * 从原始 CompanionMotion 中提取离散的关键帧列表
 */
export function extractKeyframesFromMotion(motion: CompanionMotion): { duration: number; keyframes: StudioKeyframe[] } {
  const duration = Math.max(0.5, motion.Meta.Duration || 3.0);
  const timeSet = new Set<number>([0, Number(duration.toFixed(3))]);

  for (const curve of motion.Curves) {
    const seg = curve.Segments;
    if (!seg || seg.length < 2) continue;
    timeSet.add(Number(seg[0].toFixed(3)));
    for (let cursor = 2; cursor < seg.length;) {
      const kind = seg[cursor++];
      if (kind === 1) {
        cursor += 4; // skip cp1, cp2
        timeSet.add(Number(seg[cursor++].toFixed(3)));
        cursor++; // skip endValue
      } else {
        timeSet.add(Number(seg[cursor++].toFixed(3)));
        cursor++; // skip endValue
      }
    }
  }

  // 排序并去除过密的时间戳（最小间隔 0.06s，约 16fps，保证时间轴清爽好点）
  const allSortedTimes = [...timeSet]
    .filter(t => typeof t === 'number' && !isNaN(t) && t >= 0 && t <= duration)
    .sort((a, b) => a - b);

  const filteredTimes: number[] = [allSortedTimes[0]];
  for (let i = 1; i < allSortedTimes.length; i++) {
    const prev = filteredTimes[filteredTimes.length - 1];
    const curr = allSortedTimes[i];
    if (curr - prev >= 0.06 || curr === duration) {
      filteredTimes.push(curr);
    }
  }

  const keyframes: StudioKeyframe[] = filteredTimes.map((time, idx) => {
    const values: Record<string, number> = {};
    for (const curve of motion.Curves) {
      if (curve.Target === 'Parameter') {
        const val = sampleCurve(curve.Segments, time);
        values[curve.Id] = Number(val.toFixed(3));
      }
    }
    return {
      id: `kf-${idx}-${time}`,
      time,
      values,
    };
  });

  return { duration, keyframes };
}

/**
 * 将关键帧列表导出为标准 Live2D Cubism 3/4 CompanionMotion (.komo.json)
 */
export function exportKeyframesToMotion(
  duration: number,
  keyframeList: StudioKeyframe[],
  fps = 30
): CompanionMotion {
  const sorted = [...keyframeList].sort((a, b) => a.time - b.time);
  if (sorted.length === 0) {
    sorted.push({ id: 'init-0', time: 0, values: {} });
  }
  if (sorted[0].time > 0) {
    sorted.unshift({ id: 'init-0', time: 0, values: { ...sorted[0].values } });
  }
  if (sorted[sorted.length - 1].time < duration) {
    sorted.push({ id: `end-${duration}`, time: duration, values: { ...sorted[sorted.length - 1].values } });
  }

  // 汇总所有被调整过的参数 ID
  const paramIds = new Set<string>();
  sorted.forEach(k => Object.keys(k.values).forEach(id => paramIds.add(id)));

  const curves = [];
  for (const id of paramIds) {
    const segments: number[] = [];
    const firstVal = sorted[0].values[id] ?? 0;
    segments.push(0, Number(firstVal.toFixed(3)));

    for (let i = 0; i < sorted.length - 1; i++) {
      const k0 = sorted[i];
      const k1 = sorted[i + 1];
      const t0 = k0.time;
      const v0 = k0.values[id] ?? firstVal;
      const t1 = k1.time;
      const v1 = k1.values[id] ?? v0;
      const dt = t1 - t0;

      if (dt <= 0.001) continue;

      // 经典贝塞尔平滑 S 曲线 (Cubic Ease In-Out)
      const cp1Time = Number((t0 + dt * 0.35).toFixed(4));
      const cp2Time = Number((t1 - dt * 0.35).toFixed(4));
      segments.push(1, cp1Time, Number(v0.toFixed(3)), cp2Time, Number(v1.toFixed(3)), Number(t1.toFixed(4)), Number(v1.toFixed(3)));
    }

    curves.push({
      Target: 'Parameter',
      Id: id,
      Segments: segments,
    });
  }

  return {
    Version: 3,
    Meta: {
      Duration: Number(duration.toFixed(2)),
      FadeInTime: 0.3,
    },
    Curves: curves,
  };
}

/**
 * 实时计算某一时间点下各个参数的插值
 */
export function interpolateParamsAtTime(
  keyframes: StudioKeyframe[],
  time: number,
  fallbackDefaults: Record<string, number>
): Record<string, number> {
  if (keyframes.length === 0) return { ...fallbackDefaults };
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  if (time <= sorted[0].time) return { ...fallbackDefaults, ...sorted[0].values };
  if (time >= sorted[sorted.length - 1].time) return { ...fallbackDefaults, ...sorted[sorted.length - 1].values };

  // 寻找前后相邻关键帧
  let prev = sorted[0];
  let next = sorted[sorted.length - 1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (time >= sorted[i].time && time <= sorted[i + 1].time) {
      prev = sorted[i];
      next = sorted[i + 1];
      break;
    }
  }

  const dt = next.time - prev.time;
  const progress = dt <= 0 ? 0 : Math.max(0, Math.min(1, (time - prev.time) / dt));
  // 贝塞尔缓动权重
  const eased = progress * progress * (3 - 2 * progress);

  const result: Record<string, number> = { ...fallbackDefaults };
  const allIds = new Set([...Object.keys(prev.values), ...Object.keys(next.values)]);

  for (const id of allIds) {
    const v0 = prev.values[id] ?? fallbackDefaults[id] ?? 0;
    const v1 = next.values[id] ?? fallbackDefaults[id] ?? v0;
    result[id] = Number((v0 * (1 - eased) + v1 * eased).toFixed(3));
  }

  return result;
}
