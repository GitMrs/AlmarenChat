import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { encryptConnectorCredential } from '@/lib/connectors/credentials.mjs';
import { serializeConnector } from '@/lib/connectors/registry.mjs';
import { buildCookieHeader, createQrCode, fetchNav, pollQrCode } from '@/lib/bilibili/auth.mjs';
import { ensureSpaceRoot } from '@/app/api/_lib/spaces';
import { clearCache } from '@/lib/bilibili/cache.mjs';

export const runtime = 'nodejs';

const PROVIDER = 'BILIBILI';

async function ownedSpace(spaceId: string, userId: string) {
  return prisma.space.findFirst({ where: { id: spaceId, userId }, select: { id: true } });
}

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    if (!await ownedSpace(spaceId, userId)) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const qr = await createQrCode();
    return NextResponse.json(qr);
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message || '生成二维码失败' }, { status: 500 });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    if (!await ownedSpace(spaceId, userId)) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const key = new URL(request.url).searchParams.get('key') || '';
    if (!/^[a-zA-Z0-9_-]{8,120}$/.test(key)) return NextResponse.json({ error: '二维码标识无效' }, { status: 400 });

    const result = await pollQrCode(key);
    if (result.status !== 'success' || !result.credentials) {
      return NextResponse.json({ status: result.status });
    }

    const credentials = result.credentials;
    const encrypted = encryptConnectorCredential(credentials, { spaceId, provider: PROVIDER });

    let profile: any = null;
    let warning = '';
    try {
      profile = await fetchNav(buildCookieHeader(credentials));
    } catch (error: any) {
      warning = error?.message || '账号资料读取失败';
      console.error('[bilibili-qrcode] fetchNav failed:', error?.code || '', error?.message || error);
    }

    const publicConfig = profile
      ? { mid: profile.mid, uname: profile.uname, face: profile.face, level: profile.level }
      : {};

    // 先落库再读资料：即使 nav 暂时失败，也不让已经扫码成功的登录态丢掉。
    const connector = await prisma.spaceConnector.upsert({
      where: { spaceId_provider: { spaceId, provider: PROVIDER } },
      create: {
        spaceId,
        provider: PROVIDER,
        publicConfig,
        credentialCiphertext: encrypted,
        enabled: true,
        status: 'READY',
        lastCheckedAt: new Date(),
        lastError: warning || null,
      },
      update: {
        ...(profile ? { publicConfig } : {}),
        credentialCiphertext: encrypted,
        enabled: true,
        status: 'READY',
        lastCheckedAt: new Date(),
        lastError: warning || null,
      },
    });
    await clearCache(await ensureSpaceRoot(userId, spaceId));
    return NextResponse.json({
      status: 'success',
      connector: serializeConnector(connector),
      profile,
      warning: warning || undefined,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    console.error('[bilibili-qrcode] poll failed:', error?.message || error);
    return NextResponse.json({ error: error.message || '扫码状态查询失败' }, { status: 500 });
  }
}
