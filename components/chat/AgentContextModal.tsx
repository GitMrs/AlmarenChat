'use client';

import { useMemo, useState } from 'react';
import { ContextMemoryModal, type ContextMemorySource } from '@/components/chat/ContextMemoryModal';
import { agentMemories, conversations } from '@/lib/client/api';

export default function AgentContextModal({ agentId, agentName, conversationId, conversationMode, contextMessageLimit, maxContextMessageLimit, onContextMessageLimitChange, onClose }: {
  agentId: string;
  agentName: string;
  conversationId: string | null;
  conversationMode: 'MAIN' | 'TEMPORARY';
  contextMessageLimit: number;
  maxContextMessageLimit: number;
  onContextMessageLimitChange: (value: number) => Promise<void>;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [limit, setLimit] = useState(contextMessageLimit);
  const [revision, setRevision] = useState(0);
  const source = useMemo<ContextMemorySource>(() => ({
    getStats: conversations.getContextStats,
    archive: conversations.archiveContext,
    getExperience: conversations.getContextExperience,
    removeExperience: id => agentMemories.updateExperience(agentId, id, { status: 'DELETED' }),
  }), [agentId, revision]);

  const settings = (
    <div className="rounded-xl border border-slate-200 p-3 text-xs text-slate-600">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="agent-context-limit" className="font-bold">近期原文上限</label>
        <div className="flex items-center gap-2">
          <input id="agent-context-limit" type="number" min={1} max={maxContextMessageLimit} value={limit} disabled={saving} onChange={event => setLimit(Number(event.target.value))} className="h-8 w-16 rounded-lg border border-slate-200 px-2 text-center" />
          <span>/ {maxContextMessageLimit} 条</span>
          <button type="button" disabled={saving || limit === contextMessageLimit} onClick={async () => {
            if (!Number.isInteger(limit) || limit < 1 || limit > maxContextMessageLimit) { setError(`请输入1～${maxContextMessageLimit}的整数`); return; }
            setSaving(true);
            setError('');
            try { await onContextMessageLimitChange(limit); setRevision(value => value + 1); }
            catch (err) { setError(err instanceof Error ? err.message : '保存失败'); }
            finally { setSaving(false); }
          }} className="rounded-lg bg-slate-950 px-3 py-1.5 font-bold text-white disabled:bg-slate-200 disabled:text-slate-400">{saving ? '保存中…' : '保存'}</button>
        </div>
      </div>
      <p className="mt-2 text-slate-400">条数限制用于近期原文；退出窗口的内容由会话摘要承接，实际请求还受完整上下文预算限制。</p>
      {!conversationId && <p className="mt-2 text-slate-400">发送首条消息后，可查看当前会话的统计和归档。</p>}
      {error && <p role="alert" className="mt-2 text-rose-600">{error}</p>}
    </div>
  );

  return <ContextMemoryModal open onClose={onClose} conversationId={conversationId || ''} conversationMode={conversationMode} subject={agentName} variant="agent" source={source} settings={settings} />;
}
