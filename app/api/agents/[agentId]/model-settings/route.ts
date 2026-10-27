import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { resolveAgent } from '@/app/api/_lib/spaces';
import { loadAgentModelSetting, resolveUserModelConfig } from '@/app/api/_lib/agent-model';

type RouteContext = { params: Promise<{ agentId: string }> };

async function responseFor(userId: string, agentId: string) {
  const [settings, user] = await Promise.all([
    loadAgentModelSetting(userId, agentId),
    prisma.user.findUnique({ where: { id: userId }, select: { customModelEnabled: true, modelName: true, apiBaseUrl: true, apiKey: true } }),
  ]);
  const inherited = resolveUserModelConfig(user);
  const effective = resolveUserModelConfig(user, settings);
  const preview = (config: typeof effective) => ({ modelName: config.modelName, apiBaseUrl: config.apiBaseUrl, source: config.source });
  // AgentModelSetting also stores encrypted B 站登录态；只返回模型设置，避免把凭据字段发到前端。
  const publicSettings = settings
    ? {
        modelName: settings.modelName,
        apiBaseUrl: settings.apiBaseUrl,
        apiKey: settings.apiKey,
        dailyStudyEnabled: settings.dailyStudyEnabled,
        dailyStudyStartHour: settings.dailyStudyStartHour,
        dailyStudyWindowEndHour: settings.dailyStudyWindowEndHour,
        dailyStudyMaxAttempts: settings.dailyStudyMaxAttempts,
        dailyStudyRetryBackoffMinutes: settings.dailyStudyRetryBackoffMinutes,
      }
    : null;
  return NextResponse.json({ settings: publicSettings, inherited: preview(inherited), effective: preview(effective) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    if (!await resolveAgent(agentId, userId)) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    return await responseFor(userId, agentId);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : 500 });
  }
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    if (!await resolveAgent(agentId, userId)) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: '无效的模型配置' }, { status: 400 });
    const data: {
      modelName?: string | null;
      apiBaseUrl?: string | null;
      apiKey?: string | null;
      dailyStudyEnabled?: boolean | null;
      dailyStudyStartHour?: number | null;
      dailyStudyWindowEndHour?: number | null;
      dailyStudyMaxAttempts?: number | null;
      dailyStudyRetryBackoffMinutes?: number | null;
    } = {};
    for (const field of ['modelName', 'apiBaseUrl', 'apiKey'] as const) {
      if (body[field] === undefined) continue;
      if (body[field] !== null && typeof body[field] !== 'string') return NextResponse.json({ error: '无效的模型配置' }, { status: 400 });
      data[field] = body[field]?.trim() || null;
    }
    if (body.dailyStudyEnabled !== undefined) {
      if (body.dailyStudyEnabled !== null && typeof body.dailyStudyEnabled !== 'boolean') {
        return NextResponse.json({ error: '无效的学习设置' }, { status: 400 });
      }
      data.dailyStudyEnabled = body.dailyStudyEnabled;
    }
    const scheduleRules = [
      ['dailyStudyStartHour', 0, 23],
      ['dailyStudyWindowEndHour', 1, 24],
      ['dailyStudyMaxAttempts', 1, 10],
      ['dailyStudyRetryBackoffMinutes', 1, 1440],
    ] as const;
    for (const [field, min, max] of scheduleRules) {
      if (body[field] === undefined) continue;
      if (body[field] !== null && (!Number.isInteger(body[field]) || body[field] < min || body[field] > max)) {
        return NextResponse.json({ error: '每日学习调度设置无效' }, { status: 400 });
      }
      (data as any)[field] = body[field];
    }
    const currentSetting = await loadAgentModelSetting(userId, agentId);
    const startHour = data.dailyStudyStartHour !== undefined
      ? data.dailyStudyStartHour
      : currentSetting?.dailyStudyStartHour;
    const endHour = data.dailyStudyWindowEndHour !== undefined
      ? data.dailyStudyWindowEndHour
      : currentSetting?.dailyStudyWindowEndHour;
    if (startHour !== null && startHour !== undefined && endHour !== null && endHour !== undefined && endHour <= startHour) {
      return NextResponse.json({ error: '学习结束时间必须晚于开始时间' }, { status: 400 });
    }
    if (data.apiBaseUrl) {
      try {
        if (!['http:', 'https:'].includes(new URL(data.apiBaseUrl).protocol)) throw new Error();
      } catch { return NextResponse.json({ error: '请输入有效的 HTTP 或 HTTPS 接口地址' }, { status: 400 }); }
    }
    if (Object.keys(data).length) {
      await prisma.agentModelSetting.upsert({ where: { userId_agentId: { userId, agentId } }, create: { userId, agentId, ...data }, update: data });
    }
    return await responseFor(userId, agentId);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: error.message === 'Unauthorized' ? 401 : 500 });
  }
}
