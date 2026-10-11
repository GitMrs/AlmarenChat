import { NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/app/api/_lib/auth';
import { getSpaceForUser, resolveSpaceMemberModelConfig } from '@/app/api/_lib/spaces';
import {
  buildStatementPrompt,
  parseStatementResponse,
  buildDebatePrompt,
  parseDebateResponse,
  buildVotePrompt,
  parseVoteResponse,
  buildGuessPrompt,
  parseGuessResponse,
} from '@/lib/undercover/ai-player';

function boundedText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function boundedRecords(value: unknown, maxItems: number, maxTextLength: number) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map((item: any) => ({
    ...item,
    id: boundedText(item?.id, 120),
    name: boundedText(item?.name, 120),
    playerId: boundedText(item?.playerId, 120),
    playerName: boundedText(item?.playerName, 120),
    text: boundedText(item?.text, maxTextLength),
  }));
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  let fallbackText = '';
  let fallbackTargetId = '';
  let fallbackSuspect = { playerId: '', playerName: '' };

  try {
    const { spaceId } = await params;
    const userId = getUserIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!await getSpaceForUser(spaceId, userId)) {
      return NextResponse.json({ error: 'Space not found' }, { status: 404 });
    }
    const body = await request.json();
    fallbackText = boundedText(body.fallbackText, 500);
    fallbackTargetId = boundedText(body.fallbackTargetId, 120);
    if (body.fallbackSuspect) {
      fallbackSuspect = {
        playerId: boundedText(body.fallbackSuspect.playerId, 120),
        playerName: boundedText(body.fallbackSuspect.playerName, 120),
      };
    }

    const {
      agentId,
      action = 'statement', // 'statement' | 'debate' | 'vote' | 'guess'
      word = '',
      round = 1,
      historyStatements = [],
      allStatements = [],
      candidates = [],
      aliveCandidates = [],
    } = body;
    const safeWord = boundedText(word, 200);
    const safeHistoryStatements = boundedRecords(historyStatements, 20, 400);
    const safeAllStatements = boundedRecords(allStatements, 20, 400);
    const safeCandidates = boundedRecords(candidates, 20, 120);
    const safeAliveCandidates = boundedRecords(aliveCandidates, 20, 120);

    const {
      client,
      model,
      agentName,
      agentPersona,
      agentTone,
      hasApiKey,
    } = await resolveSpaceMemberModelConfig({ spaceId, agentId, userId });

    // 如果未配置有效 API Key，直接优雅返回本地兜底规则，避免抛出 Missing credentials 错误
    if (!hasApiKey || !client) {
      console.warn(`[UndercoverAiTurn] No API key available for agent ${agentId}, fallback to local rule`);
      if (action === 'statement') {
        return NextResponse.json({ ok: true, statement: fallbackText, fromFallback: true });
      } else if (action === 'debate') {
        return NextResponse.json({ ok: true, debateText: fallbackText, suspect: fallbackSuspect, fromFallback: true });
      } else if (action === 'vote') {
        return NextResponse.json({
          ok: true,
          targetId: fallbackTargetId,
          reasoning: '基于场上局势逻辑投票',
          fromFallback: true,
        });
      } else if (action === 'guess') {
        return NextResponse.json({
          ok: true,
          reasoning: '根据综合线索分析',
          fromFallback: true,
        });
      }
    }

    let systemPrompt = '';
    let userPrompt = '';

    if (action === 'statement') {
      const p = buildStatementPrompt({
        agentName,
        agentPersona,
        agentTone,
        word: safeWord,
        round,
        historyStatements: safeHistoryStatements,
      });
      systemPrompt = p.systemPrompt;
      userPrompt = p.userPrompt;
    } else if (action === 'debate') {
      const p = buildDebatePrompt({
        agentName,
        agentPersona,
        agentTone,
        word: safeWord,
        round,
        allStatements: safeAllStatements,
        candidates: safeCandidates,
      });
      systemPrompt = p.systemPrompt;
      userPrompt = p.userPrompt;
    } else if (action === 'vote') {
      const p = buildVotePrompt({
        agentName,
        agentPersona,
        agentTone,
        word: safeWord,
        round,
        allStatements: safeAllStatements,
        aliveCandidates: safeAliveCandidates,
      });
      systemPrompt = p.systemPrompt;
      userPrompt = p.userPrompt;
    } else if (action === 'guess') {
      const p = buildGuessPrompt({
        agentName,
        agentPersona,
        agentTone,
        undercoverWord: safeWord,
        allClues: safeHistoryStatements,
      });
      systemPrompt = p.systemPrompt;
      userPrompt = p.userPrompt;
    } else {
      return NextResponse.json({ error: '无效的操作类型' }, { status: 400 });
    }

    let completionText = '';
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 350,
        response_format: { type: 'json_object' },
      });
      completionText = completion.choices[0]?.message?.content || '';
    } catch {
      // 部分模型不支持 response_format: { type: 'json_object' }，去除该参数重试一次
      const fallbackCompletion = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 350,
      });
      completionText = fallbackCompletion.choices[0]?.message?.content || '';
    }

    if (action === 'statement') {
      const statement = parseStatementResponse(completionText, fallbackText);
      return NextResponse.json({
        ok: true,
        statement,
        modelUsed: model,
        agentName,
      });
    }

    if (action === 'debate') {
      const debateResult = parseDebateResponse(completionText, fallbackSuspect, fallbackText);
      return NextResponse.json({
        ok: true,
        ...debateResult,
        modelUsed: model,
        agentName,
      });
    }

    if (action === 'vote') {
      const validIds = safeAliveCandidates.map((c: any) => c.id);
      const voteResult = parseVoteResponse(completionText, validIds, fallbackTargetId);
      return NextResponse.json({
        ok: true,
        ...voteResult,
        modelUsed: model,
        agentName,
      });
    }

    if (action === 'guess') {
      const guessResult = parseGuessResponse(completionText, fallbackText);
      return NextResponse.json({
        ok: true,
        ...guessResult,
        modelUsed: model,
        agentName,
      });
    }

    return NextResponse.json({ ok: false, error: '未处理的操作类型' }, { status: 400 });
  } catch (error: any) {
    console.warn('[UndercoverAiTurn] Model invocation failed, fallback to local rule:', error?.message || error);
    return NextResponse.json({
      ok: true,
      statement: fallbackText,
      speech: fallbackText,
      suspect: fallbackSuspect,
      targetId: fallbackTargetId,
      reasoning: '系统规则判定（模型调用异常降级）',
      fromFallback: true,
    });
  }
}
