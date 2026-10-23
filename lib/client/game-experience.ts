import { spaces } from '@/lib/client/api';

export type GameType = 'gomoku' | 'undercover' | 'trpg' | 'turtlesoup' | 'live';

export interface GameExperienceEntry {
  agentId: string;
  agentName?: string;
  content: string;
  result?: 'win' | 'loss' | 'draw';
}

type MutableSessionRef = { current: string };

export function createGameSessionId(prefix: GameType) {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${random}`;
}

/**
 * 上报一局游戏经历。失败只记录日志，不影响游戏本身。
 * 一局只调用一次，服务端会按 sessionId 去重；网络失败时最多自动重试三次。
 */
export async function recordGameExperience(
  spaceId: string | undefined,
  payload: {
    gameType: GameType;
    sessionId: string;
    topic: string;
    summary: string;
    entries: GameExperienceEntry[];
  }
) : Promise<boolean> {
  if (!spaceId || !payload.sessionId) return false;
  const entries = payload.entries.filter((entry) => entry.agentId && entry.content);
  if (!entries.length) return false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await spaces.recordGameExperience(spaceId, { ...payload, entries });
      return true;
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (attempt === 2 || (typeof status === 'number' && status < 500)) {
        console.warn('[game-experience] 记录游戏经历失败', error);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
  return false;
}

export function recordGameExperienceOnce(
  recordedRef: MutableSessionRef,
  spaceId: string | undefined,
  sessionId: string,
  payload: Omit<Parameters<typeof recordGameExperience>[1], 'sessionId'>,
) {
  const pendingKey = `pending:${sessionId}`;
  if (recordedRef.current === sessionId || recordedRef.current === pendingKey) return;
  recordedRef.current = pendingKey;
  void recordGameExperience(spaceId, { ...payload, sessionId }).then((success) => {
    if (recordedRef.current === pendingKey) recordedRef.current = success ? sessionId : '';
  });
}
