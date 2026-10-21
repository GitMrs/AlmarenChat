import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import prisma from '@/app/api/_lib/db';
import { resolveAgent } from '@/app/api/_lib/spaces';
import { loadAgentModelSetting, resolveUserModelConfig } from '@/app/api/_lib/agent-model';
import {
  getOrGenerateDailyStudy,
  markDailyStudyShared,
  isAgentStudyEnabled,
  setAgentStudyEnabled,
  getAgentStudySourceMode,
  setAgentStudySourceMode,
} from '@/lib/agent-study';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;
    const userId = requireAuth(request);
    if (!await resolveAgent(agentId, userId)) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || undefined;
    const refresh = searchParams.get('refresh') === 'true';

    const [enabled, sourceMode] = await Promise.all([
      isAgentStudyEnabled(agentId, userId),
      getAgentStudySourceMode(agentId, userId),
    ]);

    if (!enabled) {
      return NextResponse.json({ study: null, enabled: false, sourceMode });
    }

    const [user, setting] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { customModelEnabled: true, modelName: true, apiBaseUrl: true, apiKey: true } }),
      loadAgentModelSetting(userId, agentId),
    ]);
    const modelConfig = resolveUserModelConfig(user, setting);

    const study = await getOrGenerateDailyStudy(agentId, userId, {
      date,
      forceRefresh: refresh,
      sourceMode,
      modelConfig,
    });

    return NextResponse.json({ study, enabled: true, sourceMode });
  } catch (error: any) {
    console.error('[api/agents/daily-study] GET error:', error);
    return NextResponse.json(
      { error: error?.message || '获取 Agent 每日学习记录失败' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;
    const userId = requireAuth(request);
    if (!await resolveAgent(agentId, userId)) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'mark_shared';

    if (action === 'set_enabled') {
      if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'enabled 必须是布尔值' }, { status: 400 });
      const enabled = body.enabled;
      await setAgentStudyEnabled(agentId, enabled, userId);
      let study = null;
      if (enabled) {
        const [user, setting] = await Promise.all([
          prisma.user.findUnique({ where: { id: userId }, select: { customModelEnabled: true, modelName: true, apiBaseUrl: true, apiKey: true } }),
          loadAgentModelSetting(userId, agentId),
        ]);
        study = await getOrGenerateDailyStudy(agentId, userId, {
          date: body.date,
          forceRefresh: false,
          modelConfig: resolveUserModelConfig(user, setting),
        });
      }
      return NextResponse.json({ success: true, enabled, study });
    }

    if (action === 'set_source_mode') {
      const mode = body.sourceMode === 'bilibili' ? 'bilibili' : 'internal';
      await setAgentStudySourceMode(agentId, mode, userId);
      return NextResponse.json({ success: true, sourceMode: mode });
    }

    if (action === 'mark_shared') {
      const study = await markDailyStudyShared(agentId, body.date, userId);
      return NextResponse.json({ success: true, study });
    }

    if (action === 'refresh') {
      if (!await isAgentStudyEnabled(agentId, userId)) {
        return NextResponse.json({ error: '该 Agent 尚未开启自主学习' }, { status: 409 });
      }
      const [user, setting] = await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { customModelEnabled: true, modelName: true, apiBaseUrl: true, apiKey: true } }),
        loadAgentModelSetting(userId, agentId),
      ]);
      const study = await getOrGenerateDailyStudy(agentId, userId, {
        date: body.date,
        forceRefresh: true,
        modelConfig: resolveUserModelConfig(user, setting),
      });
      return NextResponse.json({ success: true, study, enabled: true });
    }

    return NextResponse.json({ error: '未知操作' }, { status: 400 });
  } catch (error: any) {
    console.error('[api/agents/daily-study] POST error:', error);
    return NextResponse.json(
      { error: error?.message || '更新 Agent 每日学习状态失败' },
      { status: 500 }
    );
  }
}
