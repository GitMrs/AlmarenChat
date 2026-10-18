export interface MotionCurve {
  Target: string;
  Id: string;
  Segments: number[];
}

export interface CompanionMotion {
  Version: number;
  Meta: { Duration: number; FadeInTime?: number };
  Curves: MotionCurve[];
}

interface MotionModel {
  params: number[];
  paramIndex: Map<string, number>;
  setParameter(id: string, value: number): void;
  setPartOpacity(id: string, value: number): void;
}

function cubic(start: number, controlStart: number, controlEnd: number, end: number, amount: number) {
  const inverse = 1 - amount;
  return inverse ** 3 * start + 3 * inverse ** 2 * amount * controlStart
    + 3 * inverse * amount ** 2 * controlEnd + amount ** 3 * end;
}

export function sampleCurve(segments: number[], time: number): number {
  let startTime = segments[0];
  let startValue = segments[1];
  if (time <= startTime) return startValue;

  for (let cursor = 2; cursor < segments.length;) {
    const kind = segments[cursor++];
    if (kind === 1) {
      const controlStartTime = segments[cursor++];
      const controlStartValue = segments[cursor++];
      const controlEndTime = segments[cursor++];
      const controlEndValue = segments[cursor++];
      const endTime = segments[cursor++];
      const endValue = segments[cursor++];
      if (time <= endTime) {
        let lower = 0;
        let upper = 1;
        for (let iteration = 0; iteration < 20; iteration++) {
          const middle = (lower + upper) / 2;
          if (cubic(startTime, controlStartTime, controlEndTime, endTime, middle) < time) lower = middle;
          else upper = middle;
        }
        return cubic(startValue, controlStartValue, controlEndValue, endValue, (lower + upper) / 2);
      }
      startTime = endTime;
      startValue = endValue;
    } else if (kind === 0 || kind === 2 || kind === 3) {
      const endTime = segments[cursor++];
      const endValue = segments[cursor++];
      if (time <= endTime) {
        if (kind === 2) return startValue;
        if (kind === 3) return endValue;
        return startValue + (endValue - startValue) * (time - startTime) / (endTime - startTime || 1);
      }
      startTime = endTime;
      startValue = endValue;
    } else {
      throw new Error(`不支持的动作曲线类型：${kind}`);
    }
  }
  return startValue;
}

export function applyMotion(model: MotionModel, motion: CompanionMotion, time: number, weight = 1) {
  for (const curve of motion.Curves) {
    const value = sampleCurve(curve.Segments, time);
    if (curve.Target === 'Parameter') {
      const index = model.paramIndex.get(curve.Id);
      if (index !== undefined) model.setParameter(curve.Id, model.params[index] * (1 - weight) + value * weight);
    } else if (curve.Target === 'PartOpacity') {
      model.setPartOpacity(curve.Id, 1 + (value - 1) * weight);
    }
  }
}

export function advancePlayback(time: number, delta: number, duration: number, loop: boolean) {
  if (duration <= 0) return { time: 0, ended: true };
  const next = Math.max(0, time + delta);
  if (next < duration) return { time: next, ended: false };
  return loop ? { time: next % duration, ended: false } : { time: duration, ended: true };
}

export function blendSnapshot(
  params: number[] | Float32Array,
  fromSnapshot: ArrayLike<number>,
  progress: number
) {
  const clamped = Math.max(0, Math.min(1, progress));
  const eased = clamped * clamped * (3 - 2 * clamped);
  const inverse = 1 - eased;
  const count = Math.min(params.length, fromSnapshot.length);
  for (let i = 0; i < count; i++) {
    params[i] = fromSnapshot[i] * inverse + params[i] * eased;
  }
}

export interface LookAtState {
  targetX: number;
  targetY: number;
  currentX: number;
  currentY: number;
}

export function createLookAtState(): LookAtState {
  return { targetX: 0, targetY: 0, currentX: 0, currentY: 0 };
}

export function advanceLookAt(state: LookAtState, delta: number, speed = 7.5) {
  const factor = 1 - Math.exp(-speed * Math.max(0, delta));
  state.currentX += (state.targetX - state.currentX) * factor;
  state.currentY += (state.targetY - state.currentY) * factor;
}

export function applyLookAt(
  model: MotionModel & {
    getParameter(id: string): number | undefined;
    man?: { parameters: { id: string; min: number; max: number }[] };
  },
  look: { currentX: number; currentY: number },
  weight = 1
) {
  if (weight <= 0.001) return;
  const setOffset = (id: string, offset: number) => {
    const idx = model.paramIndex.get(id);
    if (idx === undefined) return;
    const current = model.params[idx];
    const meta = model.man?.parameters[idx];
    let next = current + offset * weight;
    if (meta) next = Math.max(meta.min, Math.min(meta.max, next));
    model.setParameter(id, next);
  };

  setOffset('ParamEyeBallX', look.currentX * 0.75);
  setOffset('ParamEyeBallY', look.currentY * 0.75);
  setOffset('ParamAngleX', look.currentX * 18);
  setOffset('ParamAngleY', look.currentY * 13);
  setOffset('ParamAngleZ', -look.currentX * 4.5);
  setOffset('ParamBodyAngleX', look.currentX * 4.5);
}

