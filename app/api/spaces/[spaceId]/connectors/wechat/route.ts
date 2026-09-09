import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { encryptConnectorCredential } from '@/lib/connectors/credentials.mjs';
import { serializeConnector } from '@/lib/connectors/registry.mjs';

export const runtime = 'nodejs';

const PROVIDER = 'WECHAT_OFFICIAL_ACCOUNT';

async function ownedSpace(spaceId: string, userId: string) {
  return prisma.space.findFirst({ where: { id: spaceId, userId }, select: { id: true } });
}

export async function PUT(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    if (!await ownedSpace(spaceId, userId)) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const appId = typeof body.appId === 'string' ? body.appId.trim() : '';
    const appSecret = typeof body.appSecret === 'string' ? body.appSecret.trim() : '';
    if (!/^wx[a-zA-Z0-9]{4,64}$/.test(appId)) return NextResponse.json({ error: '请输入有效的微信公众号 AppID' }, { status: 400 });
    if (appSecret && (appSecret.length > 500 || /\s/.test(appSecret))) {
      return NextResponse.json({ error: '请输入有效的微信公众号 AppSecret' }, { status: 400 });
    }
    const existing = await prisma.spaceConnector.findUnique({ where: { spaceId_provider: { spaceId, provider: PROVIDER } } });
    if (!existing && !appSecret) return NextResponse.json({ error: '首次配置必须填写 AppSecret' }, { status: 400 });
    const credentialCiphertext = appSecret
      ? encryptConnectorCredential({ appSecret }, { spaceId, provider: PROVIDER })
      : existing!.credentialCiphertext;
    const connector = await prisma.spaceConnector.upsert({
      where: { spaceId_provider: { spaceId, provider: PROVIDER } },
      create: {
        spaceId,
        provider: PROVIDER,
        publicConfig: { appId },
        credentialCiphertext,
        enabled: true,
        status: 'CONFIGURED',
      },
      update: {
        publicConfig: { appId },
        credentialCiphertext,
        enabled: true,
        status: 'CONFIGURED',
        accessTokenCiphertext: null,
        accessTokenExpiresAt: null,
        lastError: null,
      },
    });
    return NextResponse.json({ connector: serializeConnector(connector) });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
    if (!connector) return NextResponse.json({ error: '请先配置微信公众号' }, { status: 404 });
    const updated = await prisma.spaceConnector.update({
      where: { id: connector.id },
      data: { enabled: body.enabled, status: body.enabled ? 'CONFIGURED' : 'DISABLED', lastError: null },
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
    if (deleted.count === 0) return NextResponse.json({ error: '微信公众号配置不存在' }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
