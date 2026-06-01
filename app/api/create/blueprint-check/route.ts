import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import { maintainMysteryBlueprint } from '@/lib/blueprint-maintenance';
import type { MysteryBlueprint } from '@/types/blueprint';

export async function POST(request: Request) {
  try {
    requireAuth(request);

    const body = await request.json();
    if (!body?.blueprint) {
      return NextResponse.json({ error: 'blueprint is required' }, { status: 400 });
    }

    const blueprint = maintainMysteryBlueprint(body.blueprint as MysteryBlueprint, body.repair !== false);
    return NextResponse.json({ success: true, blueprint });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Blueprint check error:', error);
    return NextResponse.json({ error: 'Blueprint check failed' }, { status: 500 });
  }
}
