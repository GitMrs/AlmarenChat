import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { IMAGE_GENERATION_SIZES, requestGeneratedImage } from '@/lib/image-generation.mjs';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { conversationId } = await params;
    const body = await request.json();
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    const skipPersistUserMessage = body.skipPersistUserMessage === true;
    if (body.size !== undefined && (typeof body.size !== 'string' || !IMAGE_GENERATION_SIZES.includes(body.size))) {
      return NextResponse.json({ error: '不支持的图片尺寸' }, { status: 400 });
    }
    const requestedSize = typeof body.size === 'string' && IMAGE_GENERATION_SIZES.includes(body.size)
      ? body.size
      : null;
    if (!prompt) return NextResponse.json({ error: '请输入图片描述' }, { status: 400 });
    if (prompt.length > 2_000) return NextResponse.json({ error: '图片描述不能超过 2000 个字符' }, { status: 400 });

    const [conversation, user] = await Promise.all([
      prisma.conversation.findFirst({ where: { id: conversationId, userId }, select: { id: true } }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { imageModelEnabled: true, imageModelName: true, imageModelSize: true, apiBaseUrl: true, apiKey: true },
      }),
    ]);
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    if (!user?.imageModelEnabled || !user.imageModelName || !user.apiBaseUrl || !user.apiKey) {
      return NextResponse.json({ error: '请先在账号设置中启用并完整配置图片生成模型' }, { status: 409 });
    }

    let userMessage = null;
    if (!skipPersistUserMessage) {
      userMessage = await prisma.message.create({
        data: { conversationId, role: 'user', content: prompt },
      });
    }

    const generated = await requestGeneratedImage({
      model: {
        apiKey: user.apiKey,
        baseURL: user.apiBaseUrl,
        name: user.imageModelName,
        size: user.imageModelSize || '1024x1024',
      },
      prompt,
      size: requestedSize || undefined,
      signal: request.signal,
    });
    const fileName = `${randomUUID()}${generated.extension}`;
    const outputDirectory = path.join(process.cwd(), 'public', 'uploads', 'generated');
    const outputPath = path.join(outputDirectory, fileName);
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(outputPath, generated.bytes);

    try {
      const attachment = {
        type: 'image',
        origin: 'generated',
        url: `/uploads/generated/${fileName}`,
        name: fileName,
        mimeType: generated.mimeType,
        size: generated.bytes.length,
        prompt: generated.prompt,
        model: generated.model,
        imageSize: generated.imageSize,
      };
      const message = await prisma.message.create({
        data: {
          conversationId,
          role: 'assistant',
          content: '已根据你的描述生成图片。',
          attachments: [attachment],
        },
      });
      await prisma.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
      return NextResponse.json({ userMessage, message });
    } catch (error) {
      await rm(outputPath, { force: true });
      throw error;
    }
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message || '图片生成失败' }, { status: 500 });
  }
}
