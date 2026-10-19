import { nariBehavior } from './nari';
import { yumeBehavior } from './yume';
import { lafeiBehavior } from './lafei';
import { maoBehavior } from './mao';
import type { CompanionBehavior } from './types';

const behaviorMap: Record<string, CompanionBehavior> = {
  nari: nariBehavior,
  yume: yumeBehavior,
  lafei: lafeiBehavior,
  mao: maoBehavior,
};

export function getCompanionBehavior(charId?: string): CompanionBehavior {
  if (!charId) return nariBehavior;
  return behaviorMap[charId] || nariBehavior;
}

export * from './types';
export { nariBehavior, yumeBehavior, lafeiBehavior, maoBehavior };
