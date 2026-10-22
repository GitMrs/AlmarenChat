import { NextResponse } from 'next/server';
import {
  getAllPuzzles,
  getPuzzlesCount,
  getPuzzlesSummary,
  getPuzzleById,
  getRandomPuzzle,
  getPuzzleWithIndex,
  getRandomPuzzleWithIndex,
} from '@/lib/workspace/game/turtle-soup/service';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // 1. 随机抽一题
    if (action === 'random') {
      const excludeStr = searchParams.get('exclude') || '';
      const excludeIds = excludeStr ? excludeStr.split(',') : [];
      const { puzzle, index } = getRandomPuzzleWithIndex(excludeIds);
      return NextResponse.json({
        success: true,
        index,
        puzzle: {
          id: puzzle.id,
          index,
          title: puzzle.title,
          story: puzzle.story,
          hints: puzzle.hints,
          hintCount: puzzle.hints.length,
        },
      });
    }

    // 2. 获取单题详情
    if (action === 'detail') {
      const id = searchParams.get('id') || '';
      const result = getPuzzleWithIndex(id);
      if (!result) {
        return NextResponse.json({ error: 'Puzzle not found' }, { status: 404 });
      }
      const { puzzle, index } = result;

      const revealAnswer = searchParams.get('revealAnswer') === 'true';

      return NextResponse.json({
        success: true,
        index,
        puzzle: {
          id: puzzle.id,
          index,
          title: puzzle.title,
          story: puzzle.story,
          hints: puzzle.hints,
          hintCount: puzzle.hints.length,
          ...(revealAnswer ? { answer: puzzle.answer } : {}),
        },
      });
    }

    // 3. 默认获取 350 道题书架目录
    const summaries = getPuzzlesSummary();
    return NextResponse.json({
      success: true,
      total: getPuzzlesCount(),
      puzzles: summaries,
    });
  } catch (error: any) {
    console.error('[turtle-soup/puzzles] GET Error:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}
