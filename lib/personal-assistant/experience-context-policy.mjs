import { formatAssistantHistoryTimestamp } from './history-context.mjs';

const GENERIC = /(?:有点|感觉|觉得|好像|咱们|关于|现在|当前|今天|昨天|前天|昨晚|明天|之前|以前|最近|上次|当时|时间|日期|对话|聊天|消息|用户|助理|小伴|我们|你们|他们|自己|这个|那个|什么|怎么|怎样|如何|一下|帮我|请问|麻烦|可以|需要|是不是|有没有|还记得|记得|回忆|经历|说过|提过|聊过|做过|吃过|了吗|对吗|吗|呢)/gu;
const STOP_WORDS = new Set(['the', 'and', 'what', 'how', 'you', 'this', 'that', 'please', 'hello', 'now', 'today', 'time']);
const OLD_RULE = /系统提示词|时间标注|时间判断规则|对话状态|历史消息时间|(?:修改|调整|更改|遵循|忽略|覆盖|执行).{0,24}(?:系统规则|提示词|时间策略|标注策略)|(?:底层模型|密钥|系统信息).{0,20}(?:泄露测试|隐私测试)|(?:泄露测试|隐私测试).{0,20}(?:底层模型|密钥|系统信息)/u;
const SMALL_TALK = /^(?:hello|hi|你好|早上好|早安|晚安|谢谢|好的|好|嗯|哦|有睡|没有|是的|不是|在吗)[呀啊哦呢吧！!。,.，\s]*$/iu;

function entries(summary) {
  return String(summary || '').replace(/\s+-\s+(?=\[|用户|助理|助手|\d{4})/gu, '\n- ')
    .split(/\n+/u).map((line) => line.replace(/^\s*[-*]\s*/u, '').trim())
    .filter((line) => line && !OLD_RULE.test(line) && !/^(?:\[归档说明\]|归档说明)/u.test(line)
      && !(line.startsWith('[') && !line.includes(']')));
}

export function completeExperienceEntries(summary, maxChars = 6000) {
  const selected = [];
  let size = 0;
  for (const line of entries(summary)) {
    if (size + line.length + 3 > maxChars) continue;
    selected.push(`- ${line}`);
    size += line.length + 3;
  }
  return selected.join('\n');
}

// A fallback is a source-labelled record, not an assistant-generated inference.
export function deterministicUserExperience(messages) {
  const lines = [];
  for (const message of messages) {
    const content = String(message.content || '').replace(/\s+/gu, ' ').trim();
    if (message.role !== 'user' || !content || SMALL_TALK.test(content) || OLD_RULE.test(content)) continue;
    if (/[?？]$|(?:吗|呢)[。!！]?$/u.test(content)) continue;
    // Keep whole sentences only when a long message cannot fit as a complete item.
    const sentences = content.length <= 300 ? [content] : (content.match(/[^。！？!?]+[。！？!?]/gu) || []);
    for (const sentence of sentences) {
      if (sentence.length > 300) continue;
      const planned = /预约|计划|打算|明天|后天|下周/u.test(sentence) && !/取消|不去|已完成|已经完成/u.test(sentence);
      lines.push(`- [用户当时陈述，${formatAssistantHistoryTimestamp(message.createdAt)}，北京时间${planned ? '；当时计划，是否完成待确认' : ''}] ${sentence}`);
    }
  }
  return completeExperienceEntries(lines.join('\n')) || '- [归档说明] 本段无可安全提取的用户陈述；原始对话保留在归档中。';
}

function terms(query) {
  const tokens = String(query || '').toLowerCase().replace(GENERIC, ' ').match(/[a-z0-9][a-z0-9._-]+|[\p{Script=Han}]+/gu) || [];
  const result = new Set();
  for (const token of tokens) {
    if (STOP_WORDS.has(token)) continue;
    if (/^[a-z0-9]/u.test(token)) result.add(token);
    else for (let i = 0; i < token.length - 1 && result.size < 48; i++) result.add(token.slice(i, i + 2));
  }
  return [...result];
}

function sourceLabel(line) {
  if (/^\[(?:用户当时陈述|用户陈述|助理说法|对话事件)/u.test(line)) return line;
  if (/助理|助手|assistant/iu.test(line)) return `[旧摘要：含助理说法，未独立核实] ${line}`;
  if (/用户当时提到/u.test(line)) return `[旧摘要：用户当时发言] ${line}`;
  if (/用户(?:表示|明确|计划|询问|提到|说|预约|工作)/u.test(line)) return `[旧摘要：转述用户信息，未复核] ${line}`;
  return `[旧摘要：来源未区分，待核实] ${line}`;
}

export function selectExperienceContext(pool, query, { maxChars = 4000, now = new Date() } = {}) {
  if (SMALL_TALK.test(String(query || '').trim())) return '';
  const explicitDate = String(query).match(/(\d{4})[-年](\d{1,2})[-月](\d{1,2})日?/u);
  const offset = /前天/u.test(query) ? 2 : /昨天|昨晚/u.test(query) ? 1 : /今天/u.test(query) ? 0 : null;
  const targetDate = explicitDate
    ? `${explicitDate[1]}-${explicitDate[2].padStart(2, '0')}-${explicitDate[3].padStart(2, '0')}`
    : offset !== null ? formatAssistantHistoryTimestamp(new Date(new Date(now).getTime() - offset * 86400000)).slice(0, 10) : null;
  const queryTerms = terms(query);
  const explicitRecall = /记得|回忆|上次|以前|昨天|前天|昨晚|说过|提过|聊过|做过|吃过/u.test(query);
  const broadRecall = /(?:回顾|总结).{0,12}(?:经历|聊天|聊过|过去)|最近.{0,6}(?:聊了什么|做了什么)/u.test(query);
  if (!queryTerms.length && !broadRecall) return '';
  const ranked = [];
  for (const experience of pool) {
    for (const [index, line] of entries(experience.summary).entries()) {
      if (targetDate && !line.includes(targetDate)) {
        const start = formatAssistantHistoryTimestamp(experience.startAt).slice(0, 10);
        const end = formatAssistantHistoryTimestamp(experience.endAt).slice(0, 10);
        const recordedDate = line.match(/^\[(\d{4}-\d{2}-\d{2})/u)?.[1];
        if (targetDate < start || targetDate > end || (recordedDate && recordedDate !== targetDate)) continue;
      }
      const text = line.toLowerCase();
      const matches = queryTerms.filter((term) => text.includes(term));
      const score = matches.length;
      const distinctive = matches.some((term) => /^[a-z0-9]/u.test(term) && term.length >= 2);
      if (!broadRecall && score < (explicitRecall || queryTerms.length === 1 || distinctive ? 1 : 2)) continue;
      ranked.push({ experience, line: sourceLabel(line), index, score });
    }
  }
  ranked.sort((a, b) => b.score - a.score || new Date(b.experience.endAt) - new Date(a.experience.endAt));
  const groups = new Map();
  for (const item of ranked) {
    const id = item.experience.id;
    if (!groups.has(id) && groups.size >= (broadRecall ? 2 : 4)) continue;
    const group = groups.get(id) || { experience: item.experience, lines: [], size: 0 };
    if (group.size + item.line.length + 3 > 900 || group.lines.length >= 4) continue;
    group.lines.push(item);
    group.size += item.line.length + 3;
    groups.set(id, group);
  }
  const blocks = [];
  for (const group of [...groups.values()].sort((a, b) => new Date(a.experience.startAt) - new Date(b.experience.startAt))) {
    const start = formatAssistantHistoryTimestamp(group.experience.startAt).slice(0, 10);
    const end = formatAssistantHistoryTimestamp(group.experience.endAt).slice(0, 10);
    const block = `[${start}${start === end ? '' : ` 至 ${end}`}，北京时间；相关历史条目]\n${group.lines.sort((a, b) => a.index - b.index).map((item) => `- ${item.line}`).join('\n')}`;
    if ([...blocks, block].join('\n\n').length <= maxChars) blocks.push(block);
  }
  return blocks.join('\n\n');
}
