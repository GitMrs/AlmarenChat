import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { encryptConnectorCredential } from '@/lib/connectors/credentials.mjs';
import { serializeConnector } from '@/lib/connectors/registry.mjs';
import { fetchNav, parseCookieString } from '@/lib/bilibili/auth.mjs';

export const runtime = 'nodejs';

const PROVIDER = 'BILIBILI';

async function ownedSpace(spaceId: string, userId: string) {
  return prisma.space.findFirst({ where: { id: spaceId, userId }, select: { id: true } });
}

function publicConfig(profile: { mid: string; uname: string; face: string; level: string }) {
  return { mid: profile.mid, uname: profile.uname, face: profile.face, level: profile.level };
}

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    if (!await ownedSpace(spaceId, userId)) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const connector = await prisma.spaceConnector.findUnique({ where: { spaceId_provider: { spaceId, provider: PROVIDER } } });
    return NextResponse.json({ connector: connector ? serializeConnector(connector) : null });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    if (!await ownedSpace(spaceId, userId)) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const cookieText = typeof body.cookie === 'string' ? body.cookie.trim() : '';
    if (!cookieText || cookieText.length > 8000) {
      return NextResponse.json({ error: '请粘贴完整的 B 站 Cookie' }, { status: 400 });
    }
    const credentials = parseCookieString(cookieText);
    if (!credentials) {
      return NextResponse.json({ error: 'Cookie 里缺少 SESSDATA 或 bili_jct' }, { status: 400 });
    }
    const cookie = [
      `SESSDATA=${credentials.sessdata}`,
      `bili_jct=${credentials.biliJct}`,
      credentials.dedeUserId ? `DedeUserID=${credentials.dedeUserId}` : '',
      credentials.dedeUserIdCkMd5 ? `DedeUserID__ckMd5=${credentials.dedeUserIdCkMd5}` : '',
      credentials.buvid3 ? `buvid3=${credentials.buvid3}` : '',
      credentials.buvid4 ? `buvid4=${credentials.buvid4}` : '',
    ].filter(Boolean).join('; ');

    const profile = await fetchNav(cookie);
    const connector = await prisma.spaceConnector.upsert({
      where: { spaceId_provider: { spaceId, provider: PROVIDER } },
      create: {
        spaceId,
        provider: PROVIDER,
        publicConfig: publicConfig(profile),
        credentialCiphertext: encryptConnectorCredential(credentials, { spaceId, provider: PROVIDER }),
        enabled: true,
        status: 'READY',
        lastCheckedAt: new Date(),
      },
      update: {
        publicConfig: publicConfig(profile),
        credentialCiphertext: encryptConnectorCredential(credentials, { spaceId, provider: PROVIDER }),
        enabled: true,
        status: 'READY',
        lastCheckedAt: new Date(),
        lastError: null,
        accessTokenCiphertext: null,
        accessTokenExpiresAt: null,
      },
    });
    return NextResponse.json({ connector: serializeConnector(connector), profile });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error?.code === -101) return NextResponse.json({ error: 'Cookie 已失效，请重新登录 B 站' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const body = await request.json().catch(() => ({}));
    if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: '没有可更新的设置' }, { status: 400 });
    const connector = await prisma.spaceConnector.findFirst({ where: { spaceId, provider: PROVIDER, space: { userId } } });
    if (!connector) return NextResponse.json({ error: '请先连接 B 站账号' }, { status: 404 });
    const updated = await prisma.spaceConnector.update({
      where: { id: connector.id },
      data: { enabled: body.enabled, status: body.enabled ? (connector.status === 'DISABLED' ? 'READY' : connector.status) : 'DISABLED', lastError: null },
    });
    return NextResponse.json({ connector: serializeConnector(updated) });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const deleted = await prisma.spaceConnector.deleteMany({ where: { spaceId, provider: PROVIDER, space: { userId } } });
    if (deleted.count === 0) return NextResponse.json({ error: 'B 站连接不存在' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
