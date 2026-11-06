import { personalMemoryType } from './memory-taxonomy.mjs';

function reject(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

// Both personal-memory tables share the same confirmation and revision rules.
export async function updatePersonalMemory(db, table, where, body) {
  const content = body.content === undefined ? undefined : typeof body.content === 'string' ? body.content.trim() : '';
  if (content !== undefined && (!content || content.length > 500)) reject('记忆内容需为 1～500 字');
  if (body.status !== undefined && !['ACTIVE', 'DISABLED'].includes(body.status)) reject('无效的记忆状态');
  const category = body.category === undefined ? undefined : personalMemoryType(body.category);
  if (category === null) reject('无效的记忆类型');
  return db.$transaction(async (tx) => {
    const store = tx[table];
    const existing = await store.findFirst({ where });
    if (!existing || existing.status === 'DELETED' || (category !== undefined && existing.category === 'skill')) reject('记忆不存在', 404);
    if (!['ACTIVE', 'DISABLED'].includes(existing.status)) reject('历史或待确认记忆不能编辑或启用');
    if (existing.trustStatus !== 'VERIFIED') reject('记忆尚未确认');
    const data = { content: content ?? existing.content, category: category ?? existing.category, status: body.status ?? existing.status };
    const changed = data.content !== existing.content || data.category !== existing.category;
    if (!changed && data.status === existing.status) return existing;
    const versioned = changed && (existing.category === 'rule' || data.category === 'rule');
    if (versioned && data.status !== existing.status) reject('请分别修改约定内容和启停状态');
    const replacement = versioned ? await store.create({ data: {
      userId: existing.userId, agentId: existing.agentId, ...data,
      trustStatus: 'VERIFIED', confidence: 1, factKey: existing.factKey,
      // The edited wording is explicitly confirmed here, not a quote from the old message.
      evidenceQuote: null, sourceMessageId: null,
    } }) : null;
    const result = await store.updateMany({
      where: { ...where, status: existing.status, updatedAt: existing.updatedAt },
      data: replacement ? { status: 'SUPERSEDED', supersededById: replacement.id } : data,
    });
    if (result.count !== 1) reject('记忆已被修改，请刷新后重试', 409);
    return replacement || store.findFirst({ where });
  });
}
