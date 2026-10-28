import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { resolveAgent } from '@/app/api/_lib/spaces';
import { ensureAgentMainConversation } from '@/lib/agents/ensure-main-conversation';
import { decryptQQCredential, encryptQQCredential } from '@/lib/qq-assistant/credentials.mjs';
import { buildQQWebhookUrl, generateQQWebhookToken, hashQQWebhookToken } from '@/lib/qq-assistant/webhook.mjs';

export const runtime = 'nodejs';

const MAX_BOTS_PER_USER = Math.max(1, Number(process.env.QQ_MAX_BOTS_PER_USER) || 5);

const bindingInclude = {
  botAccount: {
    include: {
      identities: true,
    },
  },
} as const;

function serializeBinding(binding: any) {
  if (!binding) return null;
  const identity = binding.botAccount?.identities?.find((item: any) => item.userId === binding.userId) || null;
  const account = binding.botAccount;
  return {
    configured: true as const,
    agentId: binding.agentId,
    botAccountId: binding.botAccountId,
    appId: account?.appId || '',
    enabled: Boolean(binding.enabled && account?.enabled),
    peerBound: Boolean(identity?.qqOpenId),
    status: account?.enabled ? (account?.status || 'PENDING') : 'DISABLED',
    lastError: account?.lastError || null,
    connectedAt: account?.connectedAt?.toISOString?.() || null,
    lastInboundAt: binding.lastInboundAt?.toISOString?.() || null,
    conversationId: binding.conversationId,
    webhookConfigured: Boolean(binding.webhookTokenHash),
    webhookCreatedAt: binding.webhookCreatedAt?.toISOString?.() || null,
    webhookLastUsedAt: binding.webhookLastUsedAt?.toISOString?.() || null,
  };
}

function webhookResponse(binding: any, token: string | null = null, baseUrl?: string) {
  return {
    binding: serializeBinding(binding),
    ...(token ? { webhookUrl: buildQQWebhookUrl(token, baseUrl) } : {}),
  };
}

function requestOrigin(request: Request) {
  const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (forwardedHost) return `${forwardedProto || 'https'}://${forwardedHost}`;
  return new URL(request.url).origin;
}

function webhookBaseUrl(request: Request) {
  return process.env.QQ_ASSISTANT_WEBHOOK_PUBLIC_URL || requestOrigin(request);
}

async function loadBinding(userId: string, agentId: string) {
  return prisma.agentQQBinding.findUnique({
    where: { userId_agentId: { userId, agentId } },
    include: bindingInclude,
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    const binding = await loadBinding(userId, agentId);
    return NextResponse.json({ binding: serializeBinding(binding), maxBots: MAX_BOTS_PER_USER });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message || 'Failed to load QQ binding' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    const body = await request.json().catch(() => ({}));
    const appId = typeof body.appId === 'string' ? body.appId.trim() : '';
    const appSecret = typeof body.appSecret === 'string' ? body.appSecret.trim() : '';

    if (!appId || appId.length > 100 || /\s/.test(appId)) {
      return NextResponse.json({ error: '请输入有效的 QQ Bot AppID' }, { status: 400 });
    }
    if (!appSecret || appSecret.length > 500) {
      return NextResponse.json({ error: '请输入有效的 QQ Bot AppSecret' }, { status: 400 });
    }

    const agent = await resolveAgent(agentId, userId);
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const existing = await loadBinding(userId, agentId);
    if (!existing) {
      const count = await prisma.agentQQBinding.count({ where: { userId } });
      if (count >= MAX_BOTS_PER_USER) {
        return NextResponse.json(
          { error: `每个用户最多接入 ${MAX_BOTS_PER_USER} 个 QQ Bot，请先解除不用的绑定。` },
          { status: 429 }
        );
      }
    }

    const [legacyCollision, accountCollision] = await Promise.all([
      prisma.assistantQQBinding.findUnique({ where: { appId }, select: { userId: true } }),
      prisma.qqBotAccount.findUnique({ where: { appId }, select: { id: true } }),
    ]);
    if (legacyCollision || (accountCollision && accountCollision.id !== existing?.botAccountId)) {
      return NextResponse.json({ error: '这个 AppID 已被其他 QQ Bot 配置使用' }, { status: 409 });
    }

    const { conversation } = await ensureAgentMainConversation(userId, agentId);
    const appSecretCiphertext = encryptQQCredential(appSecret);
    const appIdChanged = Boolean(existing && existing.botAccount.appId !== appId);

    const binding = await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.qqBotAccount.update({
          where: { id: existing.botAccountId },
          data: {
            appId,
            appSecretCiphertext,
            label: agent.name,
            kind: 'DEDICATED',
            enabled: true,
            status: 'PENDING',
            lastError: null,
            connectedAt: null,
          },
        });
        if (appIdChanged) {
          await tx.qqUserIdentity.deleteMany({ where: { botAccountId: existing.botAccountId } });
        }
        return tx.agentQQBinding.update({
          where: { id: existing.id },
          data: {
            conversationId: conversation.id,
            enabled: true,
            ...(appIdChanged ? { lastInboundAt: null } : {}),
          },
          include: bindingInclude,
        });
      }

      const account = await tx.qqBotAccount.create({
        data: {
          userId,
          appId,
          appSecretCiphertext,
          label: agent.name,
          kind: 'DEDICATED',
        },
      });
      return tx.agentQQBinding.create({
        data: {
          userId,
          agentId,
          botAccountId: account.id,
          conversationId: conversation.id,
        },
        include: bindingInclude,
      });
    });

    return NextResponse.json({ binding: serializeBinding(binding), maxBots: MAX_BOTS_PER_USER });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (error.code === 'P2002') return NextResponse.json({ error: '这个 AppID 或 Agent 已被绑定' }, { status: 409 });
    return NextResponse.json({ error: error.message || 'Failed to save QQ binding' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    const body = await request.json().catch(() => ({}));
    const existing = await loadBinding(userId, agentId);
    if (!existing) return NextResponse.json({ error: '请先配置 QQ Bot' }, { status: 404 });

    const action = typeof body.action === 'string' ? body.action : '';
    const bindingData: Record<string, unknown> = {};
    const accountData: Record<string, unknown> = {};

    if (action === 'reveal-webhook') {
      const password = typeof body.password === 'string' ? body.password : '';
      if (!password || password.length > 200) {
        return NextResponse.json({ error: '请输入当前账号密码' }, { status: 400 });
      }
      if (!existing.webhookTokenCiphertext || !existing.webhookTokenHash) {
        return NextResponse.json({ error: '请先生成 Webhook 地址' }, { status: 404 });
      }
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
      if (!user || !await bcrypt.compare(password, user.passwordHash)) {
        return NextResponse.json({ error: '账号密码不正确' }, { status: 403 });
      }
      const webhookToken = decryptQQCredential(existing.webhookTokenCiphertext);
      if (hashQQWebhookToken(webhookToken) !== existing.webhookTokenHash) {
        return NextResponse.json({ error: 'Webhook 凭据校验失败，请重新生成' }, { status: 409 });
      }
      return NextResponse.json(webhookResponse(existing, webhookToken, webhookBaseUrl(request)));
    }

    if (typeof body.enabled === 'boolean') {
      bindingData.enabled = body.enabled;
      accountData.enabled = body.enabled;
      accountData.status = body.enabled ? 'PENDING' : 'DISABLED';
      accountData.lastError = null;
      if (body.enabled) accountData.connectedAt = null;
    }
    if (action === 'reset-peer') {
      await prisma.qqUserIdentity.deleteMany({
        where: { userId, botAccountId: existing.botAccountId },
      });
      bindingData.lastInboundAt = null;
    }

    let webhookToken: string | null = null;
    if (action === 'generate-webhook' || action === 'rotate-webhook') {
      webhookToken = generateQQWebhookToken();
      bindingData.webhookTokenHash = hashQQWebhookToken(webhookToken);
      bindingData.webhookTokenCiphertext = encryptQQCredential(webhookToken);
      bindingData.webhookCreatedAt = new Date();
      bindingData.webhookLastUsedAt = null;
    }
    if (action === 'revoke-webhook') {
      bindingData.webhookTokenHash = null;
      bindingData.webhookTokenCiphertext = null;
      bindingData.webhookCreatedAt = null;
      bindingData.webhookLastUsedAt = null;
    }
    if (!Object.keys(bindingData).length && !Object.keys(accountData).length) {
      return NextResponse.json({ error: '没有可更新的设置' }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      if (Object.keys(accountData).length) {
        await tx.qqBotAccount.update({ where: { id: existing.botAccountId }, data: accountData });
      }
      if (Object.keys(bindingData).length) {
        await tx.agentQQBinding.update({ where: { id: existing.id }, data: bindingData });
      }
    });

    const binding = await loadBinding(userId, agentId);
    return NextResponse.json({
      ...webhookResponse(binding, null),
      ...(webhookToken ? { webhookUrl: buildQQWebhookUrl(webhookToken, webhookBaseUrl(request)) } : {}),
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message || 'Failed to update QQ binding' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    const existing = await loadBinding(userId, agentId);
    if (!existing) return NextResponse.json({ success: true });

    await prisma.$transaction(async (tx) => {
      await tx.agentQQBinding.delete({ where: { id: existing.id } });
      const remaining = await tx.agentQQBinding.count({ where: { botAccountId: existing.botAccountId } });
      if (remaining === 0) {
        await tx.qqBotAccount.delete({ where: { id: existing.botAccountId } });
      }
    });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message || 'Failed to delete QQ binding' }, { status: 500 });
  }
}
