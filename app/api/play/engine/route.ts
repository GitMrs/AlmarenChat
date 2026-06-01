import { NextResponse } from 'next/server';
import { requireAuth } from '@/app/api/_lib/auth';
import {
  createBlueprintRuntimeState,
  executeBlueprintAction,
  getAvailableBlueprintActions,
  resolveBlueprintAccusation,
} from '@/lib/story-engine';
import type { BlueprintRuntimeState, MysteryBlueprint } from '@/types/blueprint';

type EngineRequest =
  | {
      mode: 'init';
      blueprint: MysteryBlueprint;
    }
  | {
      mode: 'action';
      blueprint: MysteryBlueprint;
      state: BlueprintRuntimeState;
      actionId: string;
    }
  | {
      mode: 'accuse';
      blueprint: MysteryBlueprint;
      state: BlueprintRuntimeState;
      suspectId: string;
      clueIds: string[];
    };

export async function POST(request: Request) {
  try {
    requireAuth(request);

    const body = (await request.json()) as EngineRequest;
    if (!body?.blueprint) {
      return NextResponse.json({ error: 'Missing blueprint' }, { status: 400 });
    }

    if (body.mode === 'init') {
      const state = createBlueprintRuntimeState(body.blueprint);
      return NextResponse.json({
        state,
        nextActionIds: getAvailableBlueprintActions(body.blueprint, state).map((action) => action.id),
      });
    }

    if (body.mode === 'action') {
      if (!body.state || !body.actionId) {
        return NextResponse.json({ error: 'Missing state or actionId' }, { status: 400 });
      }

      return NextResponse.json({
        result: executeBlueprintAction(body.blueprint, body.state, body.actionId),
      });
    }

    if (body.mode === 'accuse') {
      if (!body.state || !body.suspectId || !Array.isArray(body.clueIds)) {
        return NextResponse.json({ error: 'Missing state, suspectId, or clueIds' }, { status: 400 });
      }

      return NextResponse.json({
        result: resolveBlueprintAccusation(body.blueprint, body.state, body.suspectId, body.clueIds),
      });
    }

    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 });
  } catch (error: any) {
    if (error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
