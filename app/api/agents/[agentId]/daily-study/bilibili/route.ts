import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { resolveAgent } from '@/app/api/_lib/spaces';
import { encryptConnectorCredential } from '@/lib/connectors/credentials.mjs';
import { buildCookieHeader, createQrCode, fetchNav, parseCookieString, pollQrCode } from '@/lib/bilibili/auth.mjs';
import { agentBilibiliCredentialContext, getAgentBilibiliConnection } from '@/lib/agent-study/bilibili-connection';

export const runtime = 'nodejs';

type Context = { params: Promise<{ agentId: string }> };

async function ownedAgent(agentId: string, userId: string) {
  return resolveAgent(agentId, userId);
}

function publicConnection(setting: any) {
  return {
    connected: Boolean(setting?.dailyStudyBilibiliCredentialCiphertext),
    profile: setting?.dailyStudyBilibiliProfile || null,
    lastCheckedAt: setting?.dailyStudyBilibiliLastCheckedAt || null,
    lastError: setting?.dailyStudyBilibiliLastError || null,
  };
}

export async function GET(request: Request, { params }: Context) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    if (!await ownedAgent(agentId, userId)) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    const key = new URL(request.url).searchParams.get('key');
    if (!key) {
      return NextResponse.json(publicConnection(await getAgentBilibiliConnection(userId, agentId)));
    }
    if (!/^[a-zA-Z0-9_-]{8,120}$/.test(key)) return NextResponse.json({ error: '二维码标识无效' }, { status: 400 });

    const result = await pollQrCode(key);
    if (result.status !== 'success' || !result.credentials) return NextResponse.json({ status: result.status });

    const credentials = result.credentials;
    const cookie = buildCookieHeader(credentials);
    let profile: any = null;
    let warning = '';
    try {
      profile = await fetchNav(cookie);
    } catch (error: any) {
      warning = error?.message || '账号资料读取失败';
    }
    const db: any = prisma;
    const setting = await db.agentModelSetting.upsert({
      where: { userId_agentId: { userId, agentId } },
      create: {
        userId,
        agentId,
        dailyStudyBilibiliCredentialCiphertext: encryptConnectorCredential(credentials, agentBilibiliCredentialContext(userId, agentId)),
        dailyStudyBilibiliProfile: profile ? { mid: profile.mid, uname: profile.uname, face: profile.face, level: profile.level } : {},
        dailyStudyBilibiliLastCheckedAt: new Date(),
        dailyStudyBilibiliLastError: warning || null,
      },
      update: {
        dailyStudyBilibiliCredentialCiphertext: encryptConnectorCredential(credentials, agentBilibiliCredentialContext(userId, agentId)),
        ...(profile ? { dailyStudyBilibiliProfile: { mid: profile.mid, uname: profile.uname, face: profile.face, level: profile.level } } : {}),
        dailyStudyBilibiliLastCheckedAt: new Date(),
        dailyStudyBilibiliLastError: warning || null,
      },
    });
    return NextResponse.json({ status: 'success', ...publicConnection(setting), warning: warning || undefined });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message || 'B 站扫码状态查询失败' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    if (!await ownedAgent(agentId, userId)) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    return NextResponse.json(await createQrCode());
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message || '生成二维码失败' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    if (!await ownedAgent(agentId, userId)) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const cookieText = typeof body.cookie === 'string' ? body.cookie.trim() : '';
    if (!cookieText || cookieText.length > 8000) {
      return NextResponse.json({ error: '请粘贴完整的 B 站 Cookie' }, { status: 400 });
    }
    const credentials = parseCookieString(cookieText);
    if (!credentials) return NextResponse.json({ error: 'Cookie 里缺少 SESSDATA 或 bili_jct' }, { status: 400 });
    const profile = await fetchNav(buildCookieHeader(credentials));
    const db: any = prisma;
    const setting = await db.agentModelSetting.upsert({
      where: { userId_agentId: { userId, agentId } },
      create: {
        userId,
        agentId,
        dailyStudyBilibiliCredentialCiphertext: encryptConnectorCredential(credentials, agentBilibiliCredentialContext(userId, agentId)),
        dailyStudyBilibiliProfile: { mid: profile.mid, uname: profile.uname, face: profile.face, level: profile.level },
        dailyStudyBilibiliLastCheckedAt: new Date(),
        dailyStudyBilibiliLastError: null,
      },
      update: {
        dailyStudyBilibiliCredentialCiphertext: encryptConnectorCredential(credentials, agentBilibiliCredentialContext(userId, agentId)),
        dailyStudyBilibiliProfile: { mid: profile.mid, uname: profile.uname, face: profile.face, level: profile.level },
        dailyStudyBilibiliLastCheckedAt: new Date(),
        dailyStudyBilibiliLastError: null,
      },
    });
    return NextResponse.json(publicConnection(setting));
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error?.code === -101) return NextResponse.json({ error: 'Cookie 已失效，请重新登录 B 站' }, { status: 409 });
    return NextResponse.json({ error: error.message || '保存 B 站登录态失败' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    if (!await ownedAgent(agentId, userId)) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    const db: any = prisma;
    await db.agentModelSetting.updateMany({
      where: { userId, agentId },
      data: {
        dailyStudyBilibiliCredentialCiphertext: null,
        dailyStudyBilibiliProfile: null,
        dailyStudyBilibiliLastCheckedAt: null,
        dailyStudyBilibiliLastError: null,
      },
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message || '断开 B 站连接失败' }, { status: 500 });
  }
}
