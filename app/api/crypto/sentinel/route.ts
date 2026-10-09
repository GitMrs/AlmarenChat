import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';
import {
  getSentinelState,
  saveSentinelState,
  checkSentinelForSpace,
} from '@/lib/crypto/sentinel-service';

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
    const { spaceId, ambushPlans, activePositions, serverSentinelEnabled, autoSyncChatPlans, deletedSignatures, action } = body;

    if (!spaceId) {
      return NextResponse.json({ error: 'spaceId is required' }, { status: 400 });
    }

    const space = await getSpaceForUser(spaceId, userId);
    if (!space) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 });
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
