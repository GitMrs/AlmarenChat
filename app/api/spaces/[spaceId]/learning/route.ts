import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';
import {
  extractSpaceLearningCandidates,
  mergeSpaceLearningCandidates,
  readSpaceLearning,
  renderSpaceLearningReadme,
  updateSpaceLearning,
  writeSpaceLearning,
} from '@/lib/space-learning.mjs';

function options(userId: string, spaceId: string) {
  return { projectRoot: process.cwd(), userId, spaceId };
}

async function synchronize(userId: string, spaceId: string) {
  const current = await readSpaceLearning(options(userId, spaceId));
  const runs = await prisma.agentRun.findMany({
    where: { spaceId, userId, status: { notIn: ['QUEUED', 'PLANNING', 'RUNNING', 'WAITING', 'WAITING_APPROVAL', 'SUMMARIZING', 'CANCEL_REQUESTED'] } },
    include: {
      tasks: { orderBy: { sortOrder: 'asc' } },
      events: { orderBy: { sequence: 'asc' } },
      artifactManifests: true,
      taskCompletions: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const merged = mergeSpaceLearningCandidates(current, extractSpaceLearningCandidates([...runs].reverse()));
  return merged.changed ? writeSpaceLearning(options(userId, spaceId), merged.state) : current;
}

export async function GET(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const learning = await synchronize(userId, spaceId);
    return NextResponse.json({ learning, readme: renderSpaceLearningReadme(learning) });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { spaceId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const current = await synchronize(userId, spaceId);
    const next = updateSpaceLearning(current, await request.json());
    const learning = await writeSpaceLearning(options(userId, spaceId), next);
    return NextResponse.json({ learning, readme: renderSpaceLearningReadme(learning) });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
