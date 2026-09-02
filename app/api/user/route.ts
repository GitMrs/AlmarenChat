import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';

export async function GET(request: Request) {
  try {
    const userId = requireAuth(request);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        apiBaseUrl: true,
        apiKey: true,
        modelName: true,
        customModelEnabled: true,
        imageModelEnabled: true,
        imageModelName: true,
        imageModelSize: true,
        tavilyApiKey: true,
        defaultStyle: true,
        contextMessageLimit: true,
        createdAt: true,
      },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = requireAuth(request);
    const body = await request.json();

    const allowedFields = ['name', 'avatar', 'apiBaseUrl', 'apiKey', 'modelName', 'customModelEnabled', 'imageModelEnabled', 'imageModelName', 'imageModelSize', 'tavilyApiKey', 'defaultStyle', 'contextMessageLimit'] as const;
    const data: Record<string, any> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        data[field] = body[field];
      }
    }
    if (data.contextMessageLimit !== undefined) {
      const limit = Number(data.contextMessageLimit);
      data.contextMessageLimit = Math.max(1, Math.min(80, Number.isFinite(limit) ? Math.floor(limit) : 40));
    }
    if (data.imageModelSize !== undefined && !['1024x1024', '1536x1024', '1024x1536'].includes(data.imageModelSize)) {
      return NextResponse.json({ error: '不支持的默认图片尺寸' }, { status: 400 });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        apiBaseUrl: true,
        apiKey: true,
        modelName: true,
        customModelEnabled: true,
        imageModelEnabled: true,
        imageModelName: true,
        imageModelSize: true,
        tavilyApiKey: true,
        defaultStyle: true,
        contextMessageLimit: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ user });
  } catch (e: any) {
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
