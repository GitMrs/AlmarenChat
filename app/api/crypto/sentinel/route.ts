import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';
import {
  getSentinelState,
  saveSentinelState,
  checkSentinelForSpace,
} from '@/lib/crypto/sentinel-service';
import type { SpaceCryptoPlanDecisionAttachment } from '@/types';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);
    const { searchParams } = new URL(request.url);
    const spaceId = searchParams.get('spaceId');

    if (!spaceId) {
      return NextResponse.json({ error: 'spaceId is required' }, { status: 400 });
    }

    const space = await getSpaceForUser(spaceId, userId);
    if (!space) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    }

    const state = await getSentinelState(spaceId);
    return NextResponse.json({ success: true, data: state });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json();
    const { spaceId, ambushPlans, activePositions, serverSentinelEnabled, autoSyncChatPlans, deletedSignatures, action, messageId } = body;

    if (!spaceId) {
      return NextResponse.json({ error: 'spaceId is required' }, { status: 400 });
    }

    const space = await getSpaceForUser(spaceId, userId);
    if (!space) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    }

    if (action === 'apply-decision') {
      if (space.templateId !== 'crypto-contract-trading') {
        return NextResponse.json({ error: '该空间不支持交易计划' }, { status: 400 });
      }
      const message = await prisma.spaceMessage.findFirst({
        where: { id: String(messageId || ''), spaceId },
        select: { id: true, attachments: true },
      });
      const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
      const decision = attachments.find((item: any) => item?.type === 'crypto_plan_decision_v1') as unknown as SpaceCryptoPlanDecisionAttachment | undefined;
      if (!message || decision?.mode !== 'CREATE' || decision.action !== 'WATCH' || !decision.proposedPlan) {
        return NextResponse.json({ error: '该消息不包含可加入观察的交易策略' }, { status: 400 });
      }

      const current = await getSentinelState(spaceId);
      const existing = current.ambushPlans.find((plan) => plan.sourceMessageId === message.id);
      if (existing) return NextResponse.json({ success: true, data: current, plan: existing });

      const source = decision.proposedPlan;
      const plan = {
        id: decision.targetPlanId || `plan-${message.id}`,
        symbol: source.symbol,
        name: source.name,
        direction: source.direction,
        entryMin: source.entryMin,
        entryMax: source.entryMax,
        stopLoss: source.stopLoss,
        takeProfit1: source.takeProfit1,
        takeProfit2: source.takeProfit2,
        invalidationPrice: source.invalidationPrice,
        createdAt: decision.analyzedAt,
        expiresInHours: 8,
        watchEnabled: false,
        notifyQQ: false,
        sourceMessageId: message.id,
      };
      const saved = await saveSentinelState(spaceId, userId, {
        ambushPlans: [...current.ambushPlans, plan],
      });
      return NextResponse.json({ success: true, data: saved, plan });
    }

    // 动作一：仅触发一次服务端实时巡检
    if (action === 'check') {
      const checkResult = await checkSentinelForSpace(spaceId, 'MANUAL');
      return NextResponse.json({ success: true, checkResult });
    }

    // 动作二：保存盯盘数据到云端服务端数据库 (Prisma Space.templateSnapshot)
    const saved = await saveSentinelState(spaceId, userId, {
      ambushPlans,
      activePositions,
      serverSentinelEnabled,
      autoSyncChatPlans,
      deletedSignatures,
    });

    // 保存后顺带进行一次检查
    let checkResult = null;
    if (saved.serverSentinelEnabled) {
      checkResult = await checkSentinelForSpace(spaceId, 'API');
    }

    return NextResponse.json({
      success: true,
      message: '云端 7×24H 盯盘配置已成功同步到服务端数据库',
      data: saved,
      checkResult,
    });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
