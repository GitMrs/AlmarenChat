import type { DetectiveScore, DetectiveRank, TurtleSoupCategory } from './types';

export function inferCategory(
  puzzle: { title: string; story: string; answer?: string },
  index: number
): TurtleSoupCategory {
  const text = `${puzzle.title} ${puzzle.story} ${puzzle.answer || ''}`.toLowerCase();

  const classicKeywords = ['海龟汤', '水草', '盲人', '侏儒', '跳楼', '照相', '录音机', '吃肉', '蜡烛', '关灯', '寄居蟹', '牛吃草', '终点线'];
  if (classicKeywords.some((k) => text.includes(k)) || index <= 20) {
    return '经典必玩';
  }

  const horrorKeywords = ['杀', '死', '尸', '凶手', '鲜血', '毒', '罪', '犯罪', '监狱', '勒死', '淹死', '谋杀', '血迹', '幽灵', '鬼', '停尸房'];
  if (horrorKeywords.some((k) => text.includes(k))) {
    return '悬疑惊悚';
  }

  const sciFiKeywords = ['时间', '时光', '倒计时', '机器', '游戏', '代码', '梦', '记忆', '复制', '穿越', '实验', '电梯', '镜子', '太空', '机器人'];
  if (sciFiKeywords.some((k) => text.includes(k))) {
    return '脑洞逻辑';
  }

  return '趣味温情';
}

export function inferDifficulty(puzzle: { story: string; answer?: string }): number {
  const len = (puzzle.story || '').length + (puzzle.answer || '').length;
  if (len > 340) return 4;
  if (len > 220) return 3;
  if (len > 120) return 2;
  return 1;
}

export function calculateDetectiveScore(
  isSolved: boolean,
  questionCount: number,
  hintsUsed: number
): DetectiveScore {
  if (!isSolved) {
    return {
      rank: 'C',
      rankTitle: '未完待续 · 封存悬案',
      rankBadge: '📜 留白卷宗',
      questionCount,
      hintsUsed,
      comment: '海龟汤的独特魅力正在于其出人意料的诡谲切面。推演过程中的每一个假设都熠熠生辉，案件真相已妥善封存！',
    };
  }

  // 极少提问、直击命门（直觉流）
  if (questionCount <= 5 && hintsUsed === 0) {
    return {
      rank: 'SSS',
      rankTitle: '直觉破局派 · 洞悉天机',
      rankBadge: '⚡ 直觉神探',
      questionCount,
      hintsUsed,
      comment: '直觉敏锐如鹰隼！仅凭数问便一击穿透迷雾，守秘人 DM 都为你起立鼓掌！',
    };
  }

  // 善用锦囊与搭子协同（团队统帅型）
  if (hintsUsed >= 2) {
    return {
      rank: 'S',
      rankTitle: '协同领袖型 · 智囊突围',
      rankBadge: '🧩 团队统帅',
      questionCount,
      hintsUsed,
      comment: '善于统筹全局、博采众长！在关键瓶颈期果断联动锦囊与队友打破死锁，带领团队拨云见日！',
    };
  }

  // 10 问以内快速收束（精准流）
  if (questionCount <= 10 && hintsUsed <= 1) {
    return {
      rank: 'SS',
      rankTitle: '精准突击流 · 手术刀式推理',
      rankBadge: '💎 破晓之刃',
      questionCount,
      hintsUsed,
      comment: '逻辑清晰如手术刀般精准，几乎没有多余的试探，干净利落地完成了真相拼图！',
    };
  }

  // 系统性排查、步步为营（严谨排查流）
  if (questionCount > 10) {
    return {
      rank: 'S',
      rankTitle: '缜密排查流 · 步步为营',
      rankBadge: '🔍 严谨名捕',
      questionCount,
      hintsUsed,
      comment: '逻辑严密，不放过任何一个变量！用扎实的排除法锁死所有假象，剩下的无论多不可思议，都是真相！',
    };
  }

  return {
    rank: 'A',
    rankTitle: '百折不挠流 · 执着寻真',
    rankBadge: '🎖️ 资深探员',
    questionCount,
    hintsUsed,
    comment: '虽有波折但坚韧不拔，在不断的否定中抽丝剥茧，最终拨开云雾见青天！',
  };
}

export function getDetectiveTitle(solvedCount: number): {
  title: string;
  badge: string;
  level: number;
} {
  if (solvedCount >= 20) return { title: '终极名侦探', badge: '🏆', level: 5 };
  if (solvedCount >= 10) return { title: '贝克街首席', badge: '⚖️', level: 4 };
  if (solvedCount >= 4) return { title: '密室克星', badge: '🧩', level: 3 };
  if (solvedCount >= 1) return { title: '敏锐神探', badge: '🕵️‍♂️', level: 2 };
  return { title: '见习探员', badge: '🔍', level: 1 };
}
