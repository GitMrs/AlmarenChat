import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AgentInterestProfile } from './types';
import {
  KNOWLEDGE_FETCHABLE_SOURCES,
} from './content-kind';
import { searchBilibiliVideos } from '../video/bilibili-search.ts';

const TRENDING_DIR = path.join(process.cwd(), 'data', 'trending');

/** 可沉淀为知识的标题特征（用于知识配额选题） */
const KNOWLEDGE_HINT_PATTERN =
  /教程|指南|实践|原理|深入|如何|实现|源码|解析|入门|配置|优化|架构|避坑|手册|技巧|方案|从零|总结|算法|工具|笔记/i;
/** 明显偏资讯/观点、不适合进入知识库的标题特征 */
const NON_KNOWLEDGE_HINT_PATTERN =
  /评测|体验|上手|发布|亮相|回应|热销|暴跌|股价|官宣|直播|明星|综艺|新皮肤|活动|盘点/i;

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
 * 根据 Agent 信息与偏好，生成用于 B 站定向搜索的高质量关键词
 */
export function buildAgentBilibiliSearchQueries(
  agent: {
    id?: string;
    name?: string;
    category?: string | null;
    description?: string | null;
    tone?: string | null;
  },
  profile: AgentInterestProfile,
  dateStr?: string
): string[] {
  const queries: string[] = [];
  const category = agent.category || '';
  const substantiveKws = profile.keywords.filter((k) => k.length >= 2);

  // 1. 每日轮转关键词，保证每天学习不同细分领域，绝不重复
  if (substantiveKws.length > 0) {
    const daySeed = dateStr
      ? Math.abs(dateStr.split('-').reduce((acc, part) => acc * 31 + parseInt(part, 10), 0))
      : new Date().getDate();
    const offset = (daySeed * 2) % substantiveKws.length;
    const kw1 = substantiveKws[offset];
    const kw2 = substantiveKws[(offset + 1) % substantiveKws.length];

    if (kw1) queries.push(`${kw1} 教程`);
    if (kw2 && kw2 !== kw1) queries.push(`${kw2} 讲解`);
  }

  // 2. 结合 Agent 类别或描述提取
  if (category && !queries.some((q) => q.includes(category))) {
    queries.push(`${category} 核心指南`);
  }

  // 3. 兜底
  if (queries.length === 0) {
    queries.push('知识精要', 'AI 实践指南');
  }

  return queries.slice(0, 3);
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
    /** 至少保留几条来自可抓正文知识源的候选（默认 0） */
    knowledgeQuota?: number;
    /** 是否启用 B 站实时主动搜索（默认 true） */
    enableBilibiliSearch?: boolean;
    /** 当前用户为该 Agent 配置的 B 站登录态 */
    bilibiliCookie?: string;
  } = {}
): Promise<CandidateStudyItem[]> {
  const limit = options.limit || 3;
  const excludeIds = options.excludeIds || new Set<string>();
  const profile = resolveAgentInterestProfile(agent);
  // 默认关闭外部搜索：只有调用方显式开启（研习来源模式为 bilibili）时才访问 B 站搜索接口
  const enableBilibiliSearch = options.enableBilibiliSearch ?? false;

  // 1. 并行加载偏好源 + 保底源（有知识配额时补充可抓正文的来源）
  const sourceSet = new Set([...profile.preferredSources, 'bilibili', 'zhihu']);
  if ((options.knowledgeQuota || 0) > 0) {
    KNOWLEDGE_FETCHABLE_SOURCES.forEach((source) => sourceSet.add(source));
  }
  const snapshotsPromise = Promise.all(
    Array.from(sourceSet).map((src) => loadTrendingSnapshot(src))
  );

  // 2. 同步发起 B 站定向主动搜索（借鉴 bilibili_learning_bot 模式）
  const biliSearchPromise = (async () => {
    if (!enableBilibiliSearch) return [];
    try {
      const queries = buildAgentBilibiliSearchQueries(agent, profile);
      // 每个 query 查 6 条高赞/高播放视频，提供充足的候选池
      const searchTasks = queries.map((query) =>
        searchBilibiliVideos(query, {
          limit: 6,
          sort: 'totalrank',
          cookie: options.bilibiliCookie,
        }).catch(() => [])
      );
      const videoLists = await Promise.all(searchTasks);
      return videoLists.flat();
    } catch {
      return [];
    }
  })();

  const [snapshots, biliSearchResults] = await Promise.all([snapshotsPromise, biliSearchPromise]);

  const candidates: CandidateStudyItem[] = [];

  // 2.1 注入 B 站实时搜索结果（赋予高契合度基础分）
  for (const video of biliSearchResults) {
    const videoId = `bilibili-${video.bvid}`;
    if (excludeIds.has(videoId)) continue;

    const title = video.title;
    const desc = video.description || '';
    const fullText = `${title} ${desc}`.toLowerCase();

    // 搜索结果由于是按 Agent 偏好专门定向检索的高清干货，给予更高权重加成
    let score = 8.0;

    for (const kw of profile.keywords) {
      if (fullText.includes(kw.toLowerCase())) {
        score += 3.0;
      }
    }

    if (KNOWLEDGE_HINT_PATTERN.test(fullText)) {
      score += 3.5;
    } else if (NON_KNOWLEDGE_HINT_PATTERN.test(fullText)) {
      score -= 2.0;
    }

    // 黄金时长加权（参考 bilibili_learning_bot：6~60分钟精讲课程额外奖励）
    if (video.duration) {
      const parts = video.duration.split(':').map((p) => parseInt(p, 10));
      if (parts.length === 2 && parts[0] >= 6 && parts[0] <= 60) {
        score += 1.5;
      }
    }

    const heat = video.play ? `${Math.round(video.play / 10000)}万播放` : '推荐视频';

    candidates.push({
      id: videoId,
      source: 'bilibili',
      sourceName: 'B站搜索',
      title: video.title,
      url: video.url,
      heat,
      desc: desc.slice(0, 300),
      thumbnail: video.pic,
      author: video.author,
      matchScore: score,
    });
  }

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

      // 知识配额来源：优先“教程/指南/原理”，压低“评测/发布会/热点”
      if (KNOWLEDGE_FETCHABLE_SOURCES.has(snapshot.source)) {
        if (KNOWLEDGE_HINT_PATTERN.test(fullText)) {
          score += 2.5;
        } else if (NON_KNOWLEDGE_HINT_PATTERN.test(fullText)) {
          score -= 1.0;
        }
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

  // 4. 知识配额：保证至少 N 条来自可抓正文的知识源，避免伴侣型 Agent 天天只有见闻
  const knowledgeQuota = Math.max(0, Math.min(options.knowledgeQuota || 0, limit));
  if (knowledgeQuota > 0) {
    const countEligible = () =>
      selected.filter((item) => KNOWLEDGE_FETCHABLE_SOURCES.has(item.source)).length;
    const quotaPool = candidates.filter(
      (candidate) =>
        KNOWLEDGE_FETCHABLE_SOURCES.has(candidate.source) &&
        !selected.some((item) => item.id === candidate.id)
    );

    while (countEligible() < knowledgeQuota && quotaPool.length > 0) {
      const pick = quotaPool.shift()!;
      if (selected.length < limit) {
        selected.push(pick);
        continue;
      }
      // 替换匹配度最低的非知识源条目
      let replaceIndex = -1;
      for (let index = selected.length - 1; index >= 0; index -= 1) {
        if (!KNOWLEDGE_FETCHABLE_SOURCES.has(selected[index].source)) {
          replaceIndex = index;
          break;
        }
      }
      if (replaceIndex < 0) break;
      selected.splice(replaceIndex, 1);
      selected.push(pick);
    }
  }

  return selected;
}
