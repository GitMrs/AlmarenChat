import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

export const runtime = 'nodejs';

const ALLOWED_EXTENSIONS = ['.md', '.txt'];
const MAX_FILE_SIZE = 1024 * 1024;

function isAllowedFile(file: File) {
  const name = file.name.toLowerCase();
  return ALLOWED_EXTENSIONS.some((extension) => name.endsWith(extension));
}

export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    const searchParams = new URL(request.url).searchParams;
    const documentId = searchParams.get('documentId');
    const query = searchParams.get('q')?.trim();

    const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { creatorId: true } });
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    if (agent.creatorId !== userId) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

    if (query) {
      const { getKnowledgeHits } = await import('@/lib/knowledge');
      const hits = await getKnowledgeHits(agentId, query);
      return NextResponse.json({ hits });
    }

    if (documentId) {
      const document = await prisma.knowledgeDocument.findFirst({
        where: { id: documentId, agentId },
        select: { id: true, fileName: true },
      });
      if (!document) return NextResponse.json({ error: 'Knowledge document not found' }, { status: 404 });

      const chunks = await prisma.knowledgeChunk.findMany({
        where: { documentId, agentId },
        orderBy: { chunkIndex: 'asc' },
        select: {
          id: true,
          chunkIndex: true,
          content: true,
          createdAt: true,
        },
      });

      return NextResponse.json({ document, chunks });
    }

    const documents = await prisma.knowledgeDocument.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { chunks: true } } },
    });

    return NextResponse.json({ documents });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;

    const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { creatorId: true } });
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    if (agent.creatorId !== userId) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: '请选择要上传的文档。' }, { status: 400 });
    if (!isAllowedFile(file)) return NextResponse.json({ error: '第一版只支持 .txt 和 .md 文件。' }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: '文档不能超过 1MB。' }, { status: 400 });

    const content = await file.text();
    const { indexKnowledgeDocument } = await import('@/lib/knowledge');
    const result = await indexKnowledgeDocument(agentId, file, content);

    return NextResponse.json({
      document: result.document,
      chunkCount: result.chunkCount,
    });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const userId = requireAuth(request);
    const { agentId } = await params;
    const documentId = new URL(request.url).searchParams.get('documentId');

    if (!documentId) return NextResponse.json({ error: 'Missing documentId' }, { status: 400 });

    const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { creatorId: true } });
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    if (agent.creatorId !== userId) return NextResponse.json({ error: 'Not authorized' }, { status: 403 });

    const document = await prisma.knowledgeDocument.findFirst({
      where: { id: documentId, agentId },
      select: { id: true },
    });
    if (!document) return NextResponse.json({ error: 'Knowledge document not found' }, { status: 404 });

    await prisma.knowledgeDocument.delete({ where: { id: document.id } });

    return NextResponse.json({ success: true });
  } catch (e: any) {
    if (e.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
