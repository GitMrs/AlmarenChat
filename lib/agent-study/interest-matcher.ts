import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentInterestProfile } from './types';

const TRENDING_DIR = path.join(process.cwd(), 'data', 'trending');

export interface RawTrendingItem {
  id: string;
  source: string;
  sourceName: string;
  title: string;
  url: string;
  heat?: string;
  desc?: string;
  thumbnail?: string;
  extra?: {
    owner?: string;
    view?: number;
    like?: number;
    author?: string;
  };
}

export interface CandidateStudyItem {
  id: string;
  source: string;
  sourceName: string;
  title: string;
  url: string;
  heat?: string;
  desc: string;
  thumbnail?: string;
  author?: string;
  matchScore: number;
}

/**
 * 内置角色或常见领域的专属偏好字典
 */
const KNOWN_AGENT_PROFILES: Record<string, AgentInterestProfile> = {
  'companion-nari': {
    keywords: ['心理', '治愈', '生活', '美食', '做饭', '烘焙', '温暖', '情绪', '日常', '花房', '摄影', '手作'],
    preferredSources: ['bilibili', 'zhihu', 'weibo', 'weread', 'douban-movie'],
  },
  'companion-yume': {
    keywords: ['音乐', '歌姬', '二次元', '动漫', '游戏', '流行', '好玩', '元气', '节奏', '翻唱'],
    preferredSources: ['bilibili', 'acfun', 'genshin', 'weibo', 'zhihu'],
  },
  'companion-lafei': {
    keywords: ['动漫', '二次元', '红酒', '美食', '打盹', '放松', '休闲', '游戏', '睡眠', '调酒'],
    preferredSources: ['bilibili', 'acfun', 'genshin', 'zhihu', 'douban-movie'],
  },
  'companion-mao': {
    keywords: ['猫', '萌宠', '小鱼干', '可爱', '生活', '日常', '趣味', '零食', '宠物'],
    preferredSources: ['bilibili', 'zhihu', 'weibo', 'douban-movie'],
  },
};

/**
 * 按 Agent 领域/类别推导兴趣画像
 */
export function resolveAgentInterestProfile(agent: {
  id?: string;
  name?: string;
  category?: string | null;
  description?: string | null;
  tone?: string | null;
}): AgentInterestProfile {
  if (agent.id && KNOWN_AGENT_PROFILES[agent.id]) {
    return KNOWN_AGENT_PROFILES[agent.id];
  }

  const category = agent.category || '';
  const desc = agent.description || '';
  const name = agent.name || '';

  const keywords: string[] = [];
  let preferredSources: string[] = ['bilibili', 'zhihu'];

  if (/心理|情绪|陪伴|治愈/i.test(category + desc)) {
    keywords.push('心理', '情绪', '治愈', '生活', '成长', '人际', '日常', '沟通');
    preferredSources = ['bilibili', 'zhihu', 'weread', 'weibo'];
  } else if (/代码|技术|开发|架构|工程|编程/i.test(category + desc)) {
    keywords.push('开源', 'AI', '架构', '前端', '算法', '代码', '工具', '技术', '全栈');
    preferredSources = ['hellogithub', 'juejin', 'csdn', 'ithome', 'zhihu'];
  } else if (/金融|财务|理财|投资|经济/i.test(category + desc)) {
    keywords.push('宏观', '投资', '商业', '经济', '股市', '研报', '市场', '财报', '创业');
    preferredSources = ['36kr', 'coindesk', 'blockbeats', 'zhihu', 'thepaper'];
  } else if (/写作|小说|历史|文学|故事/i.test(category + desc)) {
    keywords.push('历史', '小说', '剧情', '设定', '奇幻', '文学', '人物', '灵感', '神话');
    preferredSources = ['weread', 'zhihu', 'bilibili', 'douban-movie'];
  } else if (/娱乐|二次元|游戏|动漫/i.test(category + desc)) {
    keywords.push('游戏', '动漫', '二次元', '电竞', '影视', '彩蛋', '番剧');
    preferredSources = ['bilibili', 'acfun', 'genshin', 'douban-movie', 'hupu'];
  } else {
    keywords.push('生活', '新知', '有趣', '技能', '思考', '科技', '热点');
    preferredSources = ['bilibili', 'zhihu', '36kr', 'sspai', 'weibo'];
  }

  // 从描述提取补充词
  const matchWords = (desc + ' ' + name).match(/[\u4e00-\u9fa5]{2,4}/g);
  if (matchWords) {
    for (const w of matchWords.slice(0, 6)) {
      if (!keywords.includes(w)) keywords.push(w);
    }
  }

  return { keywords, preferredSources };
}

/**
 * 读取本地指定数据源的热搜数据
 */
export async function loadTrendingSnapshot(sourceId: string): Promise<{
  source: string;
  sourceName: string;
  items: RawTrendingItem[];
} | null> {
  const filePath = path.join(TRENDING_DIR, `${sourceId}.json`);
  try {
    const raw = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items)) {
      return {
        source: parsed.source || sourceId,
        sourceName: parsed.sourceName || sourceId,
        items: parsed.items,
      };
    }
  } catch {
    // 允许部分数据源文件缺失
  }
  return null;
}

/**
 * 匹配当天与该 Agent 契合度最高的 N 条学习候选（默认 3 条）
 */
export async function matchAgentStudyCandidates(
  agent: {
    id?: string;
    name?: string;
    category?: string | null;
    description?: string | null;
    tone?: string | null;
  },
  options: {
    limit?: number;
    excludeIds?: Set<string>;
  } = {}
): Promise<CandidateStudyItem[]> {
  const limit = options.limit || 3;
  const excludeIds = options.excludeIds || new Set<string>();
  const profile = resolveAgentInterestProfile(agent);

  // 1. 并行加载偏好源 + 保底源
  const sourceSet = new Set([...profile.preferredSources, 'bilibili', 'zhihu']);
  const snapshots = await Promise.all(
    Array.from(sourceSet).map((src) => loadTrendingSnapshot(src))
  );

  const candidates: CandidateStudyItem[] = [];

  for (const snapshot of snapshots) {
    if (!snapshot || !snapshot.items) continue;

    for (const item of snapshot.items) {
      if (!item.title || !item.url) continue;
      if (excludeIds.has(item.id)) continue;

      const title = item.title;
      const desc = item.desc || '';
      const fullText = `${title} ${desc}`.toLowerCase();

      // 计算匹配分
      let score = 0;

      // 关键词命中
      for (const kw of profile.keywords) {
        if (fullText.includes(kw.toLowerCase())) {
          score += 3;
        }
      }

      // 偏好平台加成
      if (profile.preferredSources.includes(snapshot.source)) {
        score += 1.5;
      }

      // 包含播放量/点赞等高热度权重
      if (item.heat && /百万|千万|10万\+|100万/i.test(item.heat)) {
        score += 1.0;
      }

      // 视频源具有天然生动性，微增权重
      if (snapshot.source === 'bilibili' || snapshot.source === 'acfun') {
        score += 1.0;
      }

      const author = item.extra?.owner || item.extra?.author || undefined;

      candidates.push({
        id: item.id,
        source: snapshot.source,
        sourceName: snapshot.sourceName,
        title: item.title,
        url: item.url,
        heat: item.heat,
        desc: desc.slice(0, 300),
        thumbnail: item.thumbnail,
        author,
        matchScore: score,
      });
    }
  }

  // 2. 排序：匹配得分高优先，其次高热度
  candidates.sort((a, b) => b.matchScore - a.matchScore);

  // 3. 去重与多样性：同一数据源最多选 2 条，避免单一平台霸屏
  const selected: CandidateStudyItem[] = [];
  const sourceCount = new Map<string, number>();

  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    const currentFromSource = sourceCount.get(candidate.source) || 0;
    if (currentFromSource >= 2) continue;

    selected.push(candidate);
    sourceCount.set(candidate.source, currentFromSource + 1);
  }

  // 保底：若多样性过滤导致不足 limit 条，无差别补充
  if (selected.length < limit) {
    for (const candidate of candidates) {
      if (selected.length >= limit) break;
      if (!selected.some((s) => s.id === candidate.id)) {
        selected.push(candidate);
      }
    }
  }

  return selected;
}
