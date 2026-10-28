import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { decryptQQCredential } from '@/lib/qq-assistant/credentials.mjs';
import { buildQQWebhookUrl } from '@/lib/qq-assistant/webhook.mjs';

export const runtime = 'nodejs';

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    const binding = await prisma.agentQQBinding.findUnique({
      where: { userId_agentId: { userId, agentId } },
      include: {
        botAccount: true,
        conversation: { select: { agentName: true } },
      },
    });
    if (!binding?.enabled || !binding.botAccount.enabled) {
      return NextResponse.json({ error: 'QQ Bot 未启用' }, { status: 409 });
    }
    if (!binding.webhookTokenCiphertext) {
      return NextResponse.json({ error: '请先生成 Webhook 地址' }, { status: 409 });
    }

    const token = decryptQQCredential(binding.webhookTokenCiphertext);
    const baseUrl = process.env.QQ_ASSISTANT_WEBHOOK_INTERNAL_URL || 'http://127.0.0.1:8787';
    const response = await fetch(buildQQWebhookUrl(token, baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: `${binding.conversation.agentName || 'Agent'} QQ Bot 测试`,
        content: '这是一条来自 Almaren Chat 的 QQ Bot 测试消息。如果你收到了，说明连接正常。',
        status: 'TEST',
        idempotencyKey: `agent-qq-test:${binding.id}:${Date.now()}`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return NextResponse.json({ error: result.error || `QQ Worker 返回 HTTP ${response.status}` }, { status: 502 });
    }
    return NextResponse.json({ sent: true, messageId: result.messageId || null });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message || '测试推送失败' }, { status: 502 });
  }
}
