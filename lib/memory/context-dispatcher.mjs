import { memorySearchTerms } from './memory-recall.mjs';

const SMALL_TALK = /^(?:嗨|哈喽|你好|您好|早上好|中午好|下午好|晚上好|在吗|忙吗|嘿|hi|hello|谢谢|好的|嗯嗯)[！!。？?~～\s]*$/iu;
const KNOWLEDGE_QUERY = /[?？]|(?:怎么|如何|为什么|什么是|介绍|解释|分析|查找|查询|资料|文档|知识库|代码|实现|报错|技术|方案|写一个|制作|生成|设计|优化|修复|配置|部署|计算|比较)/iu;
const PRIORITY = { memory: 100, experience: 90, activity: 85, knowledge: 80, world: 70, platform: 60, other: 50 };

export function planContextSources(query = '') {
  const text = String(query || '').trim();
  const meaningful = Boolean(text) && !SMALL_TALK.test(text);
  return {
    memory: meaningful,
    experience: meaningful,
    knowledge: meaningful && KNOWLEDGE_QUERY.test(text),
    platform: meaningful,
    activity: meaningful,
    world: meaningful,
  };
}

function inferType(candidate) {
  if (candidate.type && candidate.type in PRIORITY) return candidate.type;
  const name = String(candidate.name || '');
  if (/长期记忆|核心记忆|相关记忆/u.test(name)) return 'memory';
  if (/经历|历史原文|会话承接/u.test(name)) return 'experience';
  if (/活动/u.test(name)) return 'activity';
  if (/知识库|知识资料/u.test(name)) return 'knowledge';
  if (/世界/u.test(name)) return 'world';
  if (/平台|空间|任务/u.test(name)) return 'platform';
  return 'other';
}

export function dispatchContextCandidates(query = '', candidates = []) {
  const terms = memorySearchTerms(query);
  return candidates
    .filter(candidate => typeof candidate?.content === 'string' && candidate.content.trim())
    .map((candidate, index) => {
      const type = inferType(candidate);
      const text = candidate.content.toLowerCase();
      const relevance = terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
      return { candidate: { name: candidate.name, content: candidate.content }, index, score: PRIORITY[type] + Math.min(10, relevance) };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(item => item.candidate);
}
