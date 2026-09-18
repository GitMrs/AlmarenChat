import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { normalizeWebhookConfig } from '@/lib/space-automation-policy.mjs';
import { getSpaceForUser } from '@/app/api/_lib/spaces';

function publicWebhook(webhook: any) {
  let bodyTemplate = webhook.bodyTemplate;
  if (typeof bodyTemplate === 'string') {
    try { bodyTemplate = JSON.parse(bodyTemplate); } catch { bodyTemplate = {}; }
  }
  return { ...webhook, bodyTemplate };
}

async function ownedWebhook(spaceId: string, webhookId: string, userId: string) {
  if (!await getSpaceForUser(spaceId, userId)) return null;
  return prisma.spaceWebhook.findFirst({ where: { id: webhookId, spaceId } });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ spaceId: string; webhookId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId, webhookId } = await params;
    const webhook = await ownedWebhook(spaceId, webhookId, userId);
    if (!webhook) return NextResponse.json({ error: '通知 Webhook 不存在' }, { status: 404 });
    const body = await request.json();
    const data: Record<string, unknown> = {};
    if (body?.name !== undefined) {
      const name = String(body.name || '').trim();
      if (!name || name.length > 80) return NextResponse.json({ error: '通知名称必须为 1 到 80 字' }, { status: 400 });
      data.name = name;
    }
    if (body?.url !== undefined || body?.bodyTemplate !== undefined) {
      const config = normalizeWebhookConfig({
        target: 'CUSTOM_WEBHOOK',
        url: body?.url ?? webhook.url,
        bodyTemplate: body?.bodyTemplate ?? webhook.bodyTemplate,
      });
      data.url = config.url;
      data.bodyTemplate = config.bodyTemplate;
      data.lastError = null;
    }
    if (body?.enabled !== undefined) data.enabled = body.enabled === true;
    if (Object.keys(data).length === 0) return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 });
    const updated = await prisma.spaceWebhook.update({ where: { id: webhookId }, data });
    return NextResponse.json({ webhook: publicWebhook(updated) });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ spaceId: string; webhookId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId, webhookId } = await params;
    if (!await ownedWebhook(spaceId, webhookId, userId)) return NextResponse.json({ error: '通知 Webhook 不存在' }, { status: 404 });
    await prisma.spaceWebhook.delete({ where: { id: webhookId } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
