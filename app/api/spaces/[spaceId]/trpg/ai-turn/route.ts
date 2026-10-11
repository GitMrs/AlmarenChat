import { NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/app/api/_lib/auth';
import { getSpaceForUser, resolveSpaceMemberModelConfig } from '@/app/api/_lib/spaces';
import {
  buildTrpgSystemPrompt,
  buildTrpgUserPrompt,
  parseAiNarrationResponse,
} from '@/lib/trpg/ai-narrator';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const { spaceId } = await params;
    const userId = getUserIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!await getSpaceForUser(spaceId, userId)) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    }
    const body = await request.json();
    const { state, actionText, checkResult, localFallbackNarration } = body;

    // TRPG 专用守秘人 DM
    const agentId = 'gaming-dm';
    const {
      client,
      model,
      hasApiKey,
    } = await resolveSpaceMemberModelConfig({ spaceId, agentId, userId });

    if (!hasApiKey || !client) {
      console.warn(`[TrpgAiTurn] No API key for agent ${agentId}, fallback to local sandbox.`);
      return NextResponse.json({ ok: false, fromFallback: true });
    }

    const systemPrompt = buildTrpgSystemPrompt(state);
    const userPrompt = buildTrpgUserPrompt(actionText, checkResult, localFallbackNarration);

    let response: any = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.8,
          max_tokens: 600,
        });
        break;
      } catch (callErr: any) {
        if (attempt === 0) {
          console.warn('[TrpgAiTurn] First attempt failed, retrying...', callErr?.message || callErr);
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        throw callErr;
      }
    }

    const fullText = response?.choices?.[0]?.message?.content?.trim() || '';
    const parsed = parseAiNarrationResponse(fullText);

    if (parsed && parsed.narration) {
      return NextResponse.json({
        ok: true,
        ...parsed,
        modelUsed: model,
      });
    }

    return NextResponse.json({
      ok: false,
      fromFallback: true,
      error: '大模型返回格式解析失败',
    });
  } catch (error: any) {
    console.warn('[TrpgAiTurn] Generation error, falling back to sandbox:', error?.message || error);
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      fromFallback: true,
    });
  }
}
