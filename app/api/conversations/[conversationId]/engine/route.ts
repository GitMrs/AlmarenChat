import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import prisma from '@/app/api/_lib/db';
import { requireAuth } from '@/app/api/_lib/auth';
import {
  executeBlueprintAction,
  getAvailableBlueprintActions,
  resolveBlueprintAccusation,
} from '@/lib/story-engine';
import type { BlueprintRuntimeState, MysteryBlueprint } from '@/types/blueprint';

type EngineRuntimeState = {
  engine: 'blueprint-v1';
  blueprint: MysteryBlueprint;
  state: BlueprintRuntimeState;
  nextActionIds: string[];
};

type EngineRequest =
  | { mode: 'action'; actionId: string }
  | { mode: 'accuse'; suspectId: string; clueIds: string[] };

type NarrationSettings = {
  apiBaseUrl?: string | null;
  apiKey?: string | null;
  modelName?: string | null;
};

function parseEngineRuntimeState(value?: string | null): EngineRuntimeState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.engine !== 'blueprint-v1' || !parsed.blueprint || !parsed.state) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function narrateEngineResult(input: {
  settings: NarrationSettings;
  blueprint: MysteryBlueprint;
  state: BlueprintRuntimeState;
  actionLabel: string;
  engineText: string;
}) {
  try {
    const client = new OpenAI({
      baseURL: input.settings.apiBaseUrl || 'https://api-inference.modelscope.cn/v1',
      apiKey: input.settings.apiKey || process.env.apiKey,
    });

    const scene = input.blueprint.scenes.find((item) => item.id === input.state.sceneId);
    const discoveredClues = input.state.discoveredClueIds
      .map((clueId) => input.blueprint.clues.find((clue) => clue.id === clueId)?.name)
      .filter(Boolean);

    const completion = await client.chat.completions.create({
      model: input.settings.modelName || 'deepseek-ai/DeepSeek-V4-Flash',
      temperature: 0.55,
      messages: [
        {
          role: 'system',
          content:
            'You narrate results for a text mystery game. The engine is the source of truth. Do not add clues, items, scene changes, suspects, or endings that are not in the engine result. Write concise Chinese narrative only.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            action: input.actionLabel,
            engineResult: input.engineText,
            currentScene: scene?.name || input.state.sceneId,
            objective: input.state.objective,
            discoveredClues,
          }),
        },
      ],
    });

    return completion.choices[0]?.message?.content?.trim() || input.engineText;
  } catch {
    return input.engineText;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const userId = requireAuth(request);
    const { conversationId } = await params;
    const body = (await request.json()) as EngineRequest;

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId },
      select: { id: true, runtimeState: true },
    });

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const runtime = parseEngineRuntimeState(conversation.runtimeState);
    if (!runtime) {
      return NextResponse.json({ error: 'Conversation has no blueprint engine state' }, { status: 400 });
    }

    const userSettings = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        customModelEnabled: true,
        apiBaseUrl: true,
        apiKey: true,
        modelName: true,
      },
    });
    const narrationSettings =
      userSettings?.customModelEnabled && userSettings.apiBaseUrl && userSettings.apiKey && userSettings.modelName
        ? userSettings
        : {};

    if (body.mode === 'action') {
      if (!body.actionId) {
        return NextResponse.json({ error: 'Missing actionId' }, { status: 400 });
      }

      const result = executeBlueprintAction(runtime.blueprint, runtime.state, body.actionId);
      const action = runtime.blueprint.actions.find((item) => item.id === body.actionId);
      const nextRuntime: EngineRuntimeState = {
        ...runtime,
        state: result.state,
        nextActionIds: result.nextActionIds,
      };
      const narrative = await narrateEngineResult({
        settings: narrationSettings,
        blueprint: runtime.blueprint,
        state: result.state,
        actionLabel: action?.label || body.actionId,
        engineText: result.visibleText,
      });

      const userMessage = await prisma.message.create({
        data: {
          conversationId,
          role: 'user',
          content: action?.label || body.actionId,
        },
      });
      const assistantMessage = await prisma.message.create({
        data: {
          conversationId,
          role: 'assistant',
          content: narrative,
        },
      });

      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          runtimeState: JSON.stringify(nextRuntime),
          currentScene: result.state.sceneId,
          currentObjective: result.state.objective,
          endedAt: result.state.endedAt ? new Date(result.state.endedAt) : undefined,
          endingType: result.state.endingId,
          updatedAt: new Date(),
        },
      });

      return NextResponse.json({
        result: { ...result, narrative },
        runtimeState: nextRuntime,
        messages: { user: userMessage, assistant: assistantMessage },
      });
    }

    if (body.mode === 'accuse') {
      if (!body.suspectId || !Array.isArray(body.clueIds)) {
        return NextResponse.json({ error: 'Missing suspectId or clueIds' }, { status: 400 });
      }

      const result = resolveBlueprintAccusation(runtime.blueprint, runtime.state, body.suspectId, body.clueIds);
      const suspect = runtime.blueprint.suspects.find((item) => item.id === body.suspectId);
      const ending = runtime.blueprint.endings.find((item) => item.id === result.endingId);
      const nextRuntime: EngineRuntimeState = {
        ...runtime,
        state: result.state,
        nextActionIds: getAvailableBlueprintActions(runtime.blueprint, result.state).map((action) => action.id),
      };
      const engineText = result.allowed
        ? ending?.description || ending?.name || (result.correct ? '指认正确，案件结束。' : '指认错误，案件结束。')
        : result.blockedReasons.join('；') || '证据不足，暂时无法做出可靠指认。';
      const narrative = await narrateEngineResult({
        settings: narrationSettings,
        blueprint: runtime.blueprint,
        state: result.state,
        actionLabel: `指认 ${suspect?.name || body.suspectId}`,
        engineText,
      });

      const userMessage = await prisma.message.create({
        data: {
          conversationId,
          role: 'user',
          content: `指认 ${suspect?.name || body.suspectId}`,
        },
      });
      const assistantMessage = await prisma.message.create({
        data: {
          conversationId,
          role: 'assistant',
          content: narrative,
        },
      });

      await prisma.conversation.update({
        where: { id: conversationId },
        data: {
          runtimeState: JSON.stringify(nextRuntime),
          currentScene: result.state.sceneId,
          currentObjective: result.state.objective,
          endedAt: result.allowed && result.state.endedAt ? new Date(result.state.endedAt) : undefined,
          endingType: result.allowed ? result.state.endingId : undefined,
          updatedAt: new Date(),
        },
      });

      return NextResponse.json({
        result: { ...result, narrative },
        runtimeState: nextRuntime,
        messages: { user: userMessage, assistant: assistantMessage },
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
