import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { testPersonalConnector } from '@/app/api/_lib/personal-connectors';
import { MAIL_URL } from '@/lib/connectors/personal-mail.mjs';

export async function GET(request: Request, { params }: { params: Promise<{ connectorId: string }> }) {
  try {
    const config = await testPersonalConnector(requireAuth(request), (await params).connectorId);
    if (config.url !== MAIL_URL) throw new Error('不是个人邮箱连接器');
    return NextResponse.json({ provider: config.headers.provider, email: config.headers.email });
  } catch (error: any) {
    return NextResponse.json({ error: error.message === 'Unauthorized' ? 'Unauthorized' : '读取邮箱配置失败' }, { status: error.message === 'Unauthorized' ? 401 : 400 });
  }
}
