import { NextResponse } from 'next/server';
import prisma from '@/app/api/_lib/db';
import { getUserIdFromRequest } from '@/app/api/_lib/auth';
import { getSpaceForUser, resolveAgent } from '@/app/api/_lib/spaces';
import { createModelClient, resolveModelName } from '@/lib/model-client';
import { findCandidateMoves, findBestMove } from '@/lib/relay/gomoku-ai';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ spaceId: string }> }
) {
  try {
    const { spaceId } = await params;
    const userId = getUserIdFromRequest(request);
    const body = await request.json();
    const {
      board,
      currentTurn = 2,
      agentId,
      opponentId,
      moveHistory = [],
      engineMode = 'perceive',
    } = body;

    if (!Array.isArray(board) || board.length !== 225) {
      return NextResponse.json({ error: '无效的五子棋盘数据' }, { status: 400 });
    }

    const space = userId
      ? await getSpaceForUser(spaceId, userId)
      : await prisma.space.findUnique({
          where: { id: spaceId },
          include: {
            members: {
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            },
          },
        });

    // 解析当前落子角色与对手角色
    const currentAgent = await resolveAgent(agentId, userId || undefined);
    const opponentAgent = await resolveAgent(opponentId, userId || undefined);

    const agentName = currentAgent?.name || '搭子棋手';
    const opponentName = opponentAgent?.name || '对手';
    const agentPersona = currentAgent?.description || currentAgent?.systemPrompt || '机智热情的五子棋对弈搭子';
    const agentTone = currentAgent?.tone || '自信幽默';

    // 确定模型配置（优先使用空间成员配置，其次用户自定义模型，最后兜底系统默认模型）
    const user = userId
      ? await prisma.user.findUnique({
          where: { id: userId },
          select: {
            customModelEnabled: true,
            apiBaseUrl: true,
            apiKey: true,
            modelName: true,
          },
        })
      : null;

    const targetMember = space?.members?.find((m: any) => m.agentId === agentId);
    const effectiveApiBaseUrl = targetMember?.apiBaseUrl?.trim() || user?.apiBaseUrl?.trim();
    const effectiveApiKey = targetMember?.apiKey?.trim() || user?.apiKey?.trim();
    const effectiveModelName = targetMember?.modelName?.trim() || user?.modelName?.trim();

    const client = createModelClient(effectiveApiBaseUrl, effectiveApiKey);
    const model = resolveModelName(effectiveModelName);

    // 启发式算法快速产出前 4 个战术候选位
    const otherTurn = currentTurn === 1 ? 2 : 1;
    const candidates = findCandidateMoves(board, currentTurn, otherTurn, 4);
    const bestFallback = candidates[0] || findBestMove(board, currentTurn, otherTurn);

    const lastMove = Array.isArray(moveHistory) && moveHistory.length > 0 ? moveHistory[moveHistory.length - 1] : null;
    const lastMoveDesc = lastMove
      ? `上一手【${lastMove.agentName || (lastMove.player === 1 ? '黑方' : '白方')}】落子在第 ${lastMove.row} 行、第 ${lastMove.col} 列`
      : '这是开局第一手';

    const candidateDescriptions = candidates
      .map((c, i) => `候选 ${i + 1}：第 ${c.row} 行、第 ${c.col} 列（坐标 ${c.row},${c.col}）- 战术评估：${c.tacticalReason}`)
      .join('\n');

    let chosenRow = bestFallback.row;
    let chosenCol = bestFallback.col;
    let chosenSpeech = '';
    let engine = engineMode === 'full' ? 'ai-autonomous' : 'ai-perceive';

    const isAutonomous = engineMode === 'full';
    let promptContent = '';

    if (isAutonomous) {
      const blackStones: string[] = [];
      const whiteStones: string[] = [];
      for (let r = 1; r <= 15; r++) {
        for (let c = 1; c <= 15; c++) {
          const val = board[(r - 1) * 15 + (c - 1)];
          if (val === 1) blackStones.push(`(${r},${c})`);
          if (val === 2) whiteStones.push(`(${r},${c})`);
        }
      }

      promptContent = `你正在沉浸式扮演五子棋选手【${agentName}】。
角色人设与性格：${agentPersona}。
对弈态度与风格：${agentTone}。

你的对手是【${opponentName}】。你当前执${currentTurn === 1 ? '黑棋（先手）' : '白棋（后手）'}。
当前对局局势：${lastMoveDesc}，全盘已进行 ${moveHistory.length} 手。

【当前棋盘已落子分布（15×15 棋盘，行 1-15，列 1-15）】：
- 黑棋(●)：${blackStones.length > 0 ? blackStones.join(' ') : '暂无'}
- 白棋(○)：${whiteStones.length > 0 ? whiteStones.join(' ') : '暂无'}
（除了上述已有棋子的坐标外，其余所有位置皆为空位，你可以自由落子）

【本局决策模式：全权掌管（无算法参谋）】：
你全权自主推演盘面，100% 靠你自己的大模型思维决定：
1. 仔细观察黑白棋子的空间连线与攻守局势，自己计算并挑出一个你认为最能制胜的空位坐标落子（必须是尚未有棋子的空格，行 1-15，列 1-15）。
2. 用符合你角色性格（${agentTone}）的语气，对【${opponentName}】说一句生动、有趣的现场即兴对局台词（40 字以内）。

【输出格式要求】：
必须严格返回纯 JSON 对象，不要附加任何 Markdown 标签或包裹说明：
{"row": <行号数字 1-15>, "col": <列号数字 1-15>, "speech": "<你的即兴台词>"}`;
    } else {
      promptContent = `你正在沉浸式扮演五子棋选手【${agentName}】。
角色人设与性格：${agentPersona}。
对弈态度与风格：${agentTone}。

你的对手是【${opponentName}】。你当前执${currentTurn === 1 ? '黑棋（先手）' : '白棋（后手）'}。
当前对局局势：${lastMoveDesc}，全盘已进行 ${moveHistory.length} 手。

【专业算路引擎提供的 JS 战术感知候选点位】：
${candidateDescriptions}

【本局决策模式：JS 战术感知（算法参谋协同）】：
1. 结合你的性格与当前战况，从上述候选点位中挑选最适合落子的一手（也可根据大局观自行决定空位行列 1-15）。
2. 用符合你角色人设（${agentTone}）的语气，对【${opponentName}】说一句生动、有趣的现场即兴对局台词（40 字以内，可针对你落子的战术进行嘲讽、自夸、吐槽或认真剖析）。

【输出格式要求】：
必须严格返回纯 JSON 对象，不要附加任何 Markdown 标签或包裹说明：
{"row": <行号数字 1-15>, "col": <列号数字 1-15>, "speech": "<你的即兴台词>"}`;
    }

    try {
      let response: any = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          response = await client.chat.completions.create({
            model,
            messages: [
              {
                role: 'system',
                content: promptContent,
              },
              {
                role: 'user',
                content: '请立即输出你的落子决定与即兴台词。',
              },
            ],
            temperature: 0.75,
            max_tokens: 150,
          });
          break;
        } catch (callErr: any) {
          if (attempt === 0) {
            console.warn('[Gomoku AI Move] First attempt failed (likely proxy/network jitter), retrying...', callErr?.message || callErr);
            await new Promise((resolve) => setTimeout(resolve, 500));
            continue;
          }
          throw callErr;
        }
      }

      const rawContent = response.choices?.[0]?.message?.content?.trim() || '';
      let parsed: any = null;
      try {
        const jsonMatch = rawContent.match(/\{[\s\S]*?\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          const cleanJson = rawContent.replace(/```json/gi, '').replace(/```/g, '').trim();
          parsed = JSON.parse(cleanJson);
        }
      } catch (parseErr) {
        console.warn('[Gomoku AI Move] JSON parse failed, rawContent was:', rawContent);
      }

      const parsedRow = Number(parsed?.row);
      const parsedCol = Number(parsed?.col);
      const parsedSpeech = typeof parsed?.speech === 'string' ? parsed.speech.trim() : '';

      // 验证坐标合法性与是否为空位
      if (
        Number.isInteger(parsedRow) &&
        parsedRow >= 1 &&
        parsedRow <= 15 &&
        Number.isInteger(parsedCol) &&
        parsedCol >= 1 &&
        parsedCol <= 15 &&
        board[(parsedRow - 1) * 15 + (parsedCol - 1)] === 0
      ) {
        chosenRow = parsedRow;
        chosenCol = parsedCol;
      } else {
        // 大模型偶发幻觉点了已有棋子或出界，安全降级至第一候选点
        chosenRow = bestFallback.row;
        chosenCol = bestFallback.col;
      }

      if (parsedSpeech) {
        chosenSpeech = parsedSpeech;
      }
    } catch (llmError) {
      console.warn('[Gomoku AI Move] LLM generation error, falling back to heuristic move:', llmError);
      engine = 'fallback';
      chosenRow = bestFallback.row;
      chosenCol = bestFallback.col;
    }

    if (!chosenSpeech) {
      chosenSpeech = `看我这一手！落子在第 ${chosenRow} 行、第 ${chosenCol} 列，这步可是关键之选！`;
    }

    return NextResponse.json({
      success: true,
      row: chosenRow,
      col: chosenCol,
      speech: chosenSpeech,
      engine,
      model,
    });
  } catch (error: any) {
    console.error('[Gomoku AI Move Error]:', error);
    return NextResponse.json({ error: error.message || 'AI 推理落子失败' }, { status: 500 });
  }
}
