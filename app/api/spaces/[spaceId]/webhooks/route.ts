import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';
import { normalizeWebhookConfig } from '@/lib/space-automation-policy.mjs';

function publicWebhook(webhook: any) {
  let bodyTemplate = webhook.bodyTemplate;
  if (typeof bodyTemplate === 'string') {
    try { bodyTemplate = JSON.parse(bodyTemplate); } catch { bodyTemplate = {}; }
  }
  return {
    id: webhook.id,
    spaceId: webhook.spaceId,
    name: webhook.name,
    url: webhook.url,
    bodyTemplate,
    enabled: Boolean(webhook.enabled),
    lastError: webhook.lastError,
    lastUsedAt: webhook.lastUsedAt,
    createdAt: webhook.createdAt,
    updatedAt: webhook.updatedAt,
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    if (!await getSpaceForUser(spaceId, userId)) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const webhooks = await prisma.spaceWebhook.findMany({ where: { spaceId }, orderBy: { createdAt: 'asc' } });
    return NextResponse.json({ webhooks: webhooks.map(publicWebhook) });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    if (!await getSpaceForUser(spaceId, userId)) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const body = await request.json();
    const name = String(body?.name || '').trim();
    if (!name || name.length > 80) return NextResponse.json({ error: '通知名称必须为 1 到 80 字' }, { status: 400 });
    const config = normalizeWebhookConfig({
      target: 'CUSTOM_WEBHOOK',
      url: body?.url,
      bodyTemplate: body?.bodyTemplate,
    });
    const webhook = await prisma.spaceWebhook.create({
      data: {
        id: randomUUID(),
        spaceId,
        name,
        url: config.url,
        bodyTemplate: config.bodyTemplate,
        enabled: body?.enabled !== false,
      },
    });
    return NextResponse.json({ webhook: publicWebhook(webhook) }, { status: 201 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (String(error.message).includes('Unique constraint')) return NextResponse.json({ error: '该空间已存在同名通知 Webhook' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
