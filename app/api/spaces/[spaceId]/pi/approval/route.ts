import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';
import { resolvePiSkillApproval } from '@/lib/pi-runtime/space-session.mjs';

export async function POST(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    if (space.runtimeType !== 'PI_CODING') {
      return NextResponse.json({ error: '当前空间不使用 Pi 运行时' }, { status: 409 });
    }
    const { approvalId, approved } = await request.json();
    if (typeof approvalId !== 'string' || typeof approved !== 'boolean') {
      return NextResponse.json({ error: 'Skill 脚本确认参数无效' }, { status: 400 });
    }
    const resolved = resolvePiSkillApproval({ approvalId, userId, spaceId, approved });
    if (!resolved) return NextResponse.json({ error: '确认请求不存在、已过期或不属于当前空间' }, { status: 404 });
    return NextResponse.json({ resolved: true });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
