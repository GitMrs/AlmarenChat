import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { serializeConnector } from '@/lib/connectors/registry.mjs';
import { readBilibiliCredentials } from '@/lib/bilibili/credentials.mjs';
import { fetchNav } from '@/lib/bilibili/auth.mjs';

export const runtime = 'nodejs';

const PROVIDER = 'BILIBILI';

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const connector = await prisma.spaceConnector.findFirst({
      where: { spaceId, provider: PROVIDER, space: { userId } },
    });
    if (!connector) return NextResponse.json({ error: '请先连接 B 站账号' }, { status: 404 });

    const credentials = readBilibiliCredentials(connector);
    const profile = await fetchNav(credentials.cookie);
    const updated = await prisma.spaceConnector.update({
      where: { id: connector.id },
      data: {
        status: 'READY',
        lastCheckedAt: new Date(),
        lastError: null,
        publicConfig: { mid: profile.mid, uname: profile.uname, face: profile.face, level: profile.level },
      },
    });
    return NextResponse.json({ connector: serializeConnector(updated), profile });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error?.code === -101 || error?.code === -111) {
      const { spaceId } = await params;
      await prisma.spaceConnector.updateMany({
        where: { spaceId, provider: PROVIDER },
        data: { status: 'EXPIRED', lastError: '登录已失效，请重新扫码', lastCheckedAt: new Date() },
      }).catch(() => null);
      return NextResponse.json({ error: 'B 站登录已失效，请重新扫码' }, { status: 409 });
    }
    return NextResponse.json({ error: error.message || '校验失败' }, { status: 500 });
  }
}
