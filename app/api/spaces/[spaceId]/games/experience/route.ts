import { NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';
import { recordGameExperienceRollup, recordSpaceAgentExperiences } from '@/app/api/_lib/agent-personal-memory';
import { GAMING_AGENTS } from '@/lib/agents/data/gaming-agents';

const GAME_TYPES = new Set(['gomoku', 'undercover', 'trpg', 'turtlesoup', 'live']);
const GAMING_AGENT_IDS = new Set(GAMING_AGENTS.map((agent) => agent.id));

function cleanText(value: unknown, limit: number) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function shanghaiDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * 对局结束时由客户端上报一次「游戏经历」，写入参与 Agent 的 AgentExperience。
 * 只保存 Agent 的记忆，不保存对局状态。
 * 跑团每次结局单独记；其余玩法按「同一天 + 同一游戏 + 同一角色」合并计数。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const { spaceId } = await params;
    const userId = getUserIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!await getSpaceForUser(spaceId, userId)) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    const gameType = cleanText(body?.gameType, 32);
    const sessionId = cleanText(body?.sessionId, 80);
    if (!GAME_TYPES.has(gameType)) {
      return NextResponse.json({ error: '不支持的游戏类型' }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9_-]{6,80}$/.test(sessionId)) {
      return NextResponse.json({ error: '无效的局 ID' }, { status: 400 });
    }

    const entries = (Array.isArray(body?.entries) ? body.entries.slice(0, 8) : [])
      .map((entry: any) => {
        const result = entry?.result === 'win' || entry?.result === 'loss' || entry?.result === 'draw'
          ? entry.result as 'win' | 'loss' | 'draw'
          : undefined;
        return {
          agentId: cleanText(entry?.agentId, 80),
          agentName: cleanText(entry?.agentName, 40) || undefined,
          content: cleanText(entry?.content, 500),
          result,
        };
      })
      .filter((entry: { agentId: string; content: string }) => entry.agentId && entry.content);
    if (!entries.length) return NextResponse.json({ ok: true, recorded: 0 });

    // 内置游戏角色可能没有加入空间成员，但它们真实参与了对局，允许写入自己的记忆。
    const extraAgentIds = entries
      .map((entry: { agentId: string }) => entry.agentId)
      .filter((agentId: string) => GAMING_AGENT_IDS.has(agentId));

    // 跑团每次结局都值得单独记；其余玩法按天合并成一条，避免刷满记忆窗口。
    const recorded = gameType === 'trpg'
      ? await recordSpaceAgentExperiences({
          userId,
          spaceId,
          sourceType: 'GAME',
          sourceId: sessionId,
          topic: cleanText(body?.topic, 160) || '空间游戏',
          summary: cleanText(body?.summary, 900),
          entries,
          extraAgentIds,
        })
      : await recordGameExperienceRollup({
          userId,
          spaceId,
          gameType,
          date: shanghaiDate(),
          sessionId,
          entries,
          extraAgentIds,
        });

    return NextResponse.json({ ok: true, recorded });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '记录游戏经历失败' }, { status: 500 });
  }
}
