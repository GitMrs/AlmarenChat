import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { testPersonalConnector } from '@/app/api/_lib/personal-connectors';
import { createConnectorClient } from '@/lib/connectors/client.mjs';
import { feishuAuth, FEISHU_URL } from '@/lib/connectors/feishu-cli.mjs';

export async function POST(request: Request, { params }: { params: Promise<{ connectorId: string }> }) {
  try {
    const config = await testPersonalConnector(requireAuth(request), (await params).connectorId);
    const started = Date.now();
    if (config.url === FEISHU_URL) {
      const status = await feishuAuth(config, 'status');
      if (!status.botAvailable && !status.userAvailable) throw new Error('飞书身份未就绪');
    }
    const tools = await createConnectorClient(config).listTools();
    return NextResponse.json({ ok: true, tools, latencyMs: Date.now() - started });
  } catch (error: any) { return NextResponse.json({ ok: false, error: error.message === 'Unauthorized' ? 'Unauthorized' : '连接检测失败，请检查地址、认证及服务状态' }, { status: error.message === 'Unauthorized' ? 401 : 400 }); }
}
