import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { listPersonalConnectors, savePersonalConnector } from '@/lib/connectors/personal-store.mjs';

export async function GET(request: Request) {
  try { return NextResponse.json({ connectors: await listPersonalConnectors(prisma, requireAuth(request)) }); }
  catch (error: any) { return NextResponse.json({ error: error.message === 'Unauthorized' ? 'Unauthorized' : '读取连接器失败，请确认已执行数据库升级' }, { status: error.message === 'Unauthorized' ? 401 : 500 }); }
}

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const connector = await savePersonalConnector(prisma, userId, await request.json(), undefined);
    return NextResponse.json({ connector }, { status: 201 });
  } catch (error: any) {
    const message = /UNIQUE|P2002/.test(error.message) ? '连接标识已存在' : error.message;
    return NextResponse.json({ error: message }, { status: message === 'Unauthorized' ? 401 : 400 });
  }
}
