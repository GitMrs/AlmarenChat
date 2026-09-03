import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import { ensurePersonalAssistant } from '@/lib/personal-assistant/profile';

function clean(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().slice(0, max) || null : undefined;
}

export async function PATCH(request: Request) {
  try {
    const userId = requireAuth(request);
    await ensurePersonalAssistant(userId);
    const body = await request.json();
    const name = clean(body.name, 24);
    const data = {
      ...(name !== undefined ? { name: name || '小伴' } : {}),
      ...(clean(body.avatar, 500) !== undefined ? { avatar: clean(body.avatar, 500) } : {}),
      ...(clean(body.identity, 1000) !== undefined ? { identity: clean(body.identity, 1000) } : {}),
      ...(clean(body.soul, 1000) !== undefined ? { soul: clean(body.soul, 1000) } : {}),
      ...(clean(body.greeting, 300) !== undefined ? { greeting: clean(body.greeting, 300) } : {}),
      ...(typeof body.proactiveEnabled === 'boolean' ? { proactiveEnabled: body.proactiveEnabled } : {}),
    };
    const profile = await prisma.personalAssistantProfile.update({ where: { userId }, data });
    return NextResponse.json({ profile });
  } catch (error: any) {
    if (error.message === 'Unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
