const SYNODIC_MONTH_MS = 29.530588853 * 86_400_000;
const REFERENCE_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const PHASE_NAMES = ['新月', '娥眉月', '上弦月', '盈凸月', '满月', '亏凸月', '下弦月', '残月'];

export function moonPhase(timestamp = Date.now()) {
  if (!Number.isFinite(timestamp)) throw new Error('月相日期无效');
  const phase = (((timestamp - REFERENCE_NEW_MOON) % SYNODIC_MONTH_MS) + SYNODIC_MONTH_MS) % SYNODIC_MONTH_MS / SYNODIC_MONTH_MS;
  const cosine = Math.cos(2 * Math.PI * phase);
  const illumination = (1 - cosine) / 2;
  const waxing = phase < 0.5;
  const radius = 17;
  const terminatorRadius = Math.abs(cosine) * radius;
  const outerSweep = waxing ? 1 : 0;
  const innerSweep = cosine >= 0 ? 1 - outerSweep : outerSweep;
  const terminator = terminatorRadius < 0.000001
    ? `L 0 ${-radius}`
    : `A ${terminatorRadius} ${radius} 0 0 ${innerSweep} 0 ${-radius}`;
  return {
    phase,
    illumination,
    name: PHASE_NAMES[Math.floor(phase * 8 + 0.5) % 8],
    path: illumination < 0.000001 ? '' : `M 0 ${-radius} A ${radius} ${radius} 0 0 ${outerSweep} 0 ${radius} ${terminator} Z`,
  };
}
