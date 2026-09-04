import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { encryptQQCredential } from '@/lib/qq-assistant/credentials.mjs';
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
  };
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
    await ensurePersonalAssistant(userId);
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
            ...(existing.appId === appId ? {} : { qqOpenId: null, lastInboundAt: null }),
          },
        });
      }

      const conversation = await tx.conversation.create({
        data: { userId, kind: 'PERSONAL_ASSISTANT', title: 'QQ 小伴' },
      });
      return tx.assistantQQBinding.create({
        data: { userId, conversationId: conversation.id, appId, appSecretCiphertext },
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
    if (typeof body.enabled === 'boolean') {
      data.enabled = body.enabled;
      data.status = body.enabled ? 'PENDING' : 'DISABLED';
      data.lastError = null;
      if (body.enabled) data.connectedAt = null;
    }
    if (body.action === 'reset-peer') {
      data.qqOpenId = null;
      data.lastInboundAt = null;
    }
    if (!Object.keys(data).length) {
      return NextResponse.json({ error: '没有可更新的设置' }, { status: 400 });
    }

    const binding = await prisma.assistantQQBinding.update({ where: { userId }, data });
    return NextResponse.json({ binding: serializeBinding(binding) });
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
