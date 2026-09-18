import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { encryptQQCredential } from '@/lib/qq-assistant/credentials.mjs';
import { buildQQWebhookUrl, generateQQWebhookToken, hashQQWebhookToken } from '@/lib/qq-assistant/webhook.mjs';
import { ensurePersonalAssistant } from '@/lib/personal-assistant/profile';

export const runtime = 'nodejs';

function serializeBinding(binding: {
  appId: string;
  enabled: boolean;
  qqOpenId: string | null;
  status: string;
  lastError: string | null;
  connectedAt: Date | null;
  lastInboundAt: Date | null;
  conversationId: string;
  webhookTokenHash: string | null;
  webhookCreatedAt: Date | null;
  webhookLastUsedAt: Date | null;
} | null) {
  if (!binding) return null;
  return {
    configured: true as const,
    appId: binding.appId,
    enabled: binding.enabled,
    peerBound: Boolean(binding.qqOpenId),
    status: binding.enabled ? binding.status : 'DISABLED',
    lastError: binding.lastError,
    connectedAt: binding.connectedAt?.toISOString() || null,
    lastInboundAt: binding.lastInboundAt?.toISOString() || null,
    conversationId: binding.conversationId,
    webhookConfigured: Boolean(binding.webhookTokenHash),
    webhookCreatedAt: binding.webhookCreatedAt?.toISOString() || null,
    webhookLastUsedAt: binding.webhookLastUsedAt?.toISOString() || null,
  };
}

function webhookResponse(binding: Parameters<typeof serializeBinding>[0], token: string | null = null) {
  return {
    binding: serializeBinding(binding),
    ...(token ? { webhookUrl: buildQQWebhookUrl(token) } : {}),
  };
}

function requestOrigin(request: Request) {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (forwardedHost) return `${forwardedProto || 'https'}://${forwardedHost}`;
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const binding = await prisma.assistantQQBinding.findUnique({ where: { userId } });
    return NextResponse.json({ binding: serializeBinding(binding) });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json().catch(() => ({}));
    const appId = typeof body.appId === 'string' ? body.appId.trim() : '';
    const appSecret = typeof body.appSecret === 'string' ? body.appSecret.trim() : '';
    if (!appId || appId.length > 100 || /\s/.test(appId)) {
      return NextResponse.json({ error: '请输入有效的 QQ Bot AppID' }, { status: 400 });
    }
    if (!appSecret || appSecret.length > 500) {
      return NextResponse.json({ error: '请输入有效的 QQ Bot AppSecret' }, { status: 400 });
    }

    const appSecretCiphertext = encryptQQCredential(appSecret);
    const profile = await ensurePersonalAssistant(userId);
    const binding = await prisma.$transaction(async (tx) => {
      const existing = await tx.assistantQQBinding.findUnique({ where: { userId } });
      if (existing) {
        return tx.assistantQQBinding.update({
          where: { userId },
          data: {
            appId,
            appSecretCiphertext,
            enabled: true,
            status: 'PENDING',
            lastError: null,
            connectedAt: null,
            conversationId: profile.conversationId,
            ...(existing.appId === appId ? {} : { qqOpenId: null, lastInboundAt: null }),
          },
        });
      }

      return tx.assistantQQBinding.create({
        data: { userId, conversationId: profile.conversationId, appId, appSecretCiphertext },
      });
    });

    return NextResponse.json({ binding: serializeBinding(binding) });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error.code === 'P2002') return NextResponse.json({ error: '这个 AppID 已被其他账号配置' }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json().catch(() => ({}));
    const existing = await prisma.assistantQQBinding.findUnique({ where: { userId } });
    if (!existing) return NextResponse.json({ error: '请先配置 QQ Bot' }, { status: 404 });

    const data: Record<string, unknown> = {};
    const action = typeof body.action === 'string' ? body.action : '';
    if (typeof body.enabled === 'boolean') {
      data.enabled = body.enabled;
      data.status = body.enabled ? 'PENDING' : 'DISABLED';
      data.lastError = null;
      if (body.enabled) data.connectedAt = null;
    }
    if (action === 'reset-peer') {
      data.qqOpenId = null;
      data.lastInboundAt = null;
    }
    let webhookToken: string | null = null;
    if (action === 'generate-webhook' || action === 'rotate-webhook') {
      webhookToken = generateQQWebhookToken();
      data.webhookTokenHash = hashQQWebhookToken(webhookToken);
      data.webhookTokenCiphertext = encryptQQCredential(webhookToken);
      data.webhookCreatedAt = new Date();
      data.webhookLastUsedAt = null;
    }
    if (action === 'revoke-webhook') {
      data.webhookTokenHash = null;
      data.webhookTokenCiphertext = null;
      data.webhookCreatedAt = null;
      data.webhookLastUsedAt = null;
    }
    if (!Object.keys(data).length) {
      return NextResponse.json({ error: '没有可更新的设置' }, { status: 400 });
    }

    const binding = await prisma.assistantQQBinding.update({ where: { userId }, data });
    return NextResponse.json({
      ...webhookResponse(binding, null),
      ...(webhookToken
        ? { webhookUrl: buildQQWebhookUrl(webhookToken, process.env.QQ_ASSISTANT_WEBHOOK_PUBLIC_URL || requestOrigin(request)) }
        : {}),
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = requireAuth(request);
    await prisma.assistantQQBinding.deleteMany({ where: { userId } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
