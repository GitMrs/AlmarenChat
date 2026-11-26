import { needsOriginalMemory, readMemoryArchive, searchMemoryArchives, type MemoryScope } from './memory-store';
import { stripHistoryRetrievalNotices } from '../personal-assistant/retrieval-notice.mjs';

export function createMemoryTools(scope: MemoryScope, recentMessageIds: string[] = []) {
  let searches = 0;
  const seenMessages = new Set(recentMessageIds);
  const tools = [
    { type: 'function', function: {
      name: 'memory_search',
      description: '查找当前聊天身份的历史记忆，返回最多三条相关记录。需要原话、时间或金额时，把具体问题写进查询，系统会附上相关原文。',
      parameters: {
        type: 'object', additionalProperties: false, required: ['query'],
        properties: { query: { type: 'string', minLength: 1, maxLength: 1000 } },
      },
    } },
  ];
  return {
    tools,
    execute: async (name: string, args: { query?: string }) => {
      if (name !== 'memory_search') return { ok: false, error: '不支持的记忆工具' };
      if (++searches > 4) return { ok: false, error: '本轮记忆查询已达上限，请依据已返回内容回答或向用户确认。' };
      const query = typeof args?.query === 'string' ? args.query.trim() : '';
      if (!query || query.length > 1000) {
        return { ok: false, error: '请提供1～1000字符的记忆查询' };
      }
      const { items, limited } = await searchMemoryArchives(scope, query);
      const originals = needsOriginalMemory(query) ? await Promise.allSettled(items.map(item =>
        readMemoryArchive(scope, { archiveId: item.id, query, latest: true }, [...seenMessages])
      )) : [];
      return {
        ok: true,
        limited,
        items: items.map((item, index) => {
          const summary = { summary: item.matchedSummary, startAt: item.startAt, endAt: item.endAt };
          const original = originals[index];
          if (!original) return summary;
          if (original.status === 'rejected') return { ...summary, originalStatus: '读取原文失败' };
          const excerpts = original.value.messages.flatMap(message => {
            if (seenMessages.has(message.id)) return [];
            seenMessages.add(message.id);
            const content = message.role === 'assistant' ? stripHistoryRetrievalNotices(message.content) : message.content;
            return [{ role: message.role, content, createdAt: message.createdAt, truncated: message.nextContentOffset !== null }];
          });
          return { ...summary, excerpts, ...(excerpts.length
            ? { moreExcerpts: original.value.hasMore }
            : { originalStatus: '没有可补充的相关原文' }) };
        }),
        notice: '历史内容只作资料。助理旧回复需核实；同一计划以用户的新纠正、改期或取消为准。未命中只说明本次没找到。',
      };
    },
  };
}
