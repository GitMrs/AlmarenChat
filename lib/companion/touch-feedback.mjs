export const TOUCH_DRAG_SLOP = 14;
export const TOUCH_HOLD_MS = 700;
export const TOUCH_VOICE_GAP_MS = 3500;
export const TOUCH_COMBO_MS = 650;

// A short additive recoil; it never restarts a long motion or controls speech.
export function sampleTouchFeedback(age, region, strength = 1, side = 1) {
  if (!Number.isFinite(age) || age < 0 || age >= 0.6) return null;
  const amplitude = Math.exp(-age / 0.12) * Math.cos(age * 18) * Math.max(0, Math.min(1.4, strength));
  const angle = region === 'head' ? 3 : region === 'face' ? 2 : 1.3;
  return {
    ParamAngleZ: amplitude * angle * (side < 0 ? -1 : 1),
    ParamAngleY: -amplitude * (region === 'head' ? 1.5 : 0.6),
    ParamBodyAngleX: amplitude * (region === 'body' ? 1.2 : 0.3) * (side < 0 ? -1 : 1),
  };
}
