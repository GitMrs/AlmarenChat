import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { getSpaceForUser } from '@/app/api/_lib/spaces';

type TaskProposalAttachment = {
  type: 'task_proposal';
  status?: string;
  [key: string]: unknown;
};

function updateTaskProposal(attachments: unknown, update: Partial<TaskProposalAttachment>) {
  if (!Array.isArray(attachments)) return null;
  let found = false;
  const next = attachments.map((attachment) => {
    if (!attachment || typeof attachment !== 'object' || (attachment as TaskProposalAttachment).type !== 'task_proposal') return attachment;
    found = true;
    return { ...attachment, ...update };
  });
  return found ? next : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; messageId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { spaceId, messageId } = await params;
    const { action } = await request.json();
    if (action !== 'reject_task_proposal') return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });

    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    const message = await prisma.spaceMessage.findFirst({ where: { id: messageId, spaceId } });
    if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    const proposal = Array.isArray(message.attachments)
      ? message.attachments.find((attachment) => attachment && typeof attachment === 'object' && (attachment as TaskProposalAttachment).type === 'task_proposal') as TaskProposalAttachment | undefined
      : undefined;
    if (!proposal) return NextResponse.json({ error: 'Task proposal not found' }, { status: 404 });
    if (proposal.status !== 'pending') return NextResponse.json({ error: 'Task proposal was already handled' }, { status: 409 });

    const attachments = updateTaskProposal(message.attachments, { status: 'rejected' });
    if (!attachments) return NextResponse.json({ error: 'Task proposal not found' }, { status: 404 });
    const updated = await prisma.spaceMessage.update({ where: { id: message.id }, data: { attachments } });
    return NextResponse.json({ message: updated });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ spaceId: string; messageId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { spaceId, messageId } = await params;
    const space = await getSpaceForUser(spaceId, userId);
    if (!space) return NextResponse.json({ error: 'Space not found' }, { status: 404 });

    await prisma.spaceMessage.deleteMany({ where: { id: messageId, spaceId } });
    await prisma.space.update({ where: { id: spaceId }, data: { updatedAt: new Date() } });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
