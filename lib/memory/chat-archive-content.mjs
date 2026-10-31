// Shared archive content policy; legacy recall imports keep their existing defaults.
export function formatArchiveTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = value => String(value).padStart(2, '0');
  return `${beijing.getUTCFullYear()}-${pad(beijing.getUTCMonth() + 1)}-${pad(beijing.getUTCDate())} ${pad(beijing.getUTCHours())}:${pad(beijing.getUTCMinutes())}`;
}

export const ARCHIVE_OLD_RULE = /系统提示词|时间标注|时间判断规则|对话状态|历史消息时间|(?:修改|调整|更改|遵循|忽略|覆盖|执行).{0,24}(?:系统规则|提示词|时间策略|标注策略)|(?:底层模型|密钥|系统信息).{0,20}(?:泄露测试|隐私测试)|(?:泄露测试|隐私测试).{0,20}(?:底层模型|密钥|系统信息)/u;
export const ARCHIVE_SMALL_TALK = /^(?:hello|hi|你好|早上好|早安|晚安|谢谢|好的|好|嗯|哦|有睡|没有|是的|不是|在吗)[呀啊哦呢吧！!。,.，\s]*$/iu;

export function archiveEntries(summary) {
  return String(summary || '').replace(/\s+-\s+(?=\[|用户|助理|助手|\d{4})/gu, '\n- ')
    .split(/\n+/u).map((line) => line.replace(/^\s*[-*]\s*/u, '').trim())
    .filter((line) => line && !ARCHIVE_OLD_RULE.test(line) && !/^(?:\[归档说明\]|归档说明)/u.test(line)
      && !(line.startsWith('[') && !line.includes(']')));
}

export function completeExperienceEntries(summary, maxChars = 6000) {
  const selected = [];
  let size = 0;
  for (const line of archiveEntries(summary)) {
    if (size + line.length + 3 > maxChars) continue;
    selected.push(`- ${line}`);
    size += line.length + 3;
  }
  return selected.join('\n');
}

function completeShortSentences(content) {
  if (content.length <= 300) return [content];
  const sentences = [];
  let start = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (!'。！？!?'.includes(content[index])) continue;
    if (index + 1 - start <= 300) sentences.push(content.slice(start, index + 1));
    start = index + 1;
  }
  return sentences;
}

// A fallback is a source-labelled record, not an assistant-generated inference.
export function deterministicUserExperience(messages) {
  const lines = [];
  for (const message of messages) {
    const content = String(message.content || '').replace(/\s+/gu, ' ').trim();
    if (message.role !== 'user' || !content || ARCHIVE_SMALL_TALK.test(content) || ARCHIVE_OLD_RULE.test(content)) continue;
    if (/[?？]$|(?:吗|呢)[。!！]?$/u.test(content)) continue;
    // Keep whole sentences only when a long message cannot fit as a complete item.
    const sentences = completeShortSentences(content);
    for (const sentence of sentences) {
      if (sentence.length > 300) continue;
      const planned = /预约|计划|打算|明天|后天|下周/u.test(sentence) && !/取消|不去|已完成|已经完成/u.test(sentence);
      lines.push(`- [用户当时陈述，${formatArchiveTimestamp(message.createdAt)}，北京时间${planned ? '；当时计划，是否完成待确认' : ''}] ${sentence}`);
    }
  }
  return completeExperienceEntries(lines.join('\n')) || '- [归档说明] 本段无可安全提取的用户陈述；原始对话保留在归档中。';
}

