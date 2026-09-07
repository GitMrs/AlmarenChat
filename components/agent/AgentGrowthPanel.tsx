'use client';

import { useEffect, useMemo, useState } from 'react';
import { Ban, BriefcaseBusiness, Check, Loader2, Pencil, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react';
import { agents as agentsApi } from '@/lib/api';
import type { AgentExperience, AgentGrowthProfile, AgentMemoryRule } from '@/types';

const CATEGORY_LABELS: Record<string, string> = {
  method: '工作方法',
  correction: '错误与纠正',
  capability: '能力经验',
};

type RuleDraft = Pick<AgentMemoryRule, 'category' | 'title' | 'instruction'>;

const EMPTY_DRAFT: RuleDraft = { category: 'method', title: '', instruction: '' };

export default function AgentGrowthPanel({ agentId }: { agentId: string }) {
  const [profile, setProfile] = useState<AgentGrowthProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<RuleDraft>(EMPTY_DRAFT);
  const [edits, setEdits] = useState<Record<string, RuleDraft>>({});

  useEffect(() => {
    let active = true;
    agentsApi.growth(agentId)
      .then((result) => { if (active) setProfile(result); })
      .catch((err) => { if (active) setError(err.message || '加载成长档案失败'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [agentId]);

  const groups = useMemo(() => ({
    pending: profile?.rules.filter((item) => item.status === 'PENDING') || [],
    active: profile?.rules.filter((item) => item.status === 'ACTIVE') || [],
    disabled: profile?.rules.filter((item) => item.status === 'DISABLED') || [],
  }), [profile]);

  const ruleDraft = (rule: AgentMemoryRule) => edits[rule.id] || {
    category: rule.category,
    title: rule.title,
    instruction: rule.instruction,
  };

  const changeRule = (rule: AgentMemoryRule, patch: Partial<RuleDraft>) => {
    setEdits((current) => ({ ...current, [rule.id]: { ...ruleDraft(rule), ...patch } }));
  };

  const updateRule = async (rule: AgentMemoryRule, action: string) => {
    setBusyId(rule.id);
    setError('');
    try {
      const value = ruleDraft(rule);
      const result = await agentsApi.updateGrowthRule(agentId, {
        id: rule.id,
        action,
        ...(action === 'approve' || action === 'update' ? value : {}),
      });
      setProfile(result);
      setEdits((current) => {
        const next = { ...current };
        delete next[rule.id];
        return next;
      });
    } catch (err: any) {
      setError(err.message || '更新员工经验失败');
    } finally {
      setBusyId(null);
    }
  };

  const deleteRule = async (rule: AgentMemoryRule) => {
    setBusyId(rule.id);
    setError('');
    try {
      setProfile(await agentsApi.deleteGrowthRule(agentId, rule.id));
    } catch (err: any) {
      setError(err.message || '删除员工经验失败');
    } finally {
      setBusyId(null);
    }
  };

  const addRule = async () => {
    setBusyId('new');
    setError('');
    try {
      setProfile(await agentsApi.addGrowthRule(agentId, draft));
      setDraft(EMPTY_DRAFT);
    } catch (err: any) {
      setError(err.message || '添加员工经验失败');
    } finally {
      setBusyId(null);
    }
  };

  const promoteExperience = (experience: AgentExperience) => {
    setDraft({
      category: 'capability',
      title: experience.title,
      instruction: `处理类似“${experience.title}”的工作时，参考这次已验收成果形成的方法：${experience.summary}`.slice(0, 1_200),
    });
    document.getElementById('agent-growth-new-rule')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  if (loading) {
    return <div className="flex min-h-64 items-center justify-center text-slate-400"><Loader2 className="animate-spin" size={24} /></div>;
  }

  const editor = (rule: AgentMemoryRule) => {
    const value = ruleDraft(rule);
    return (
      <div className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
          <select
            value={value.category}
            onChange={(event) => changeRule(rule, { category: event.target.value as RuleDraft['category'] })}
            className="h-10 rounded-lg border border-black/[0.08] bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-slate-400"
          >
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input
            value={value.title}
            onChange={(event) => changeRule(rule, { title: event.target.value })}
            className="h-10 min-w-0 rounded-lg border border-black/[0.08] bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-slate-400"
            placeholder="经验标题"
          />
        </div>
        <textarea
          value={value.instruction}
          onChange={(event) => changeRule(rule, { instruction: event.target.value })}
          rows={3}
          className="w-full resize-y rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none focus:border-slate-400"
          placeholder="员工以后遇到类似工作时应遵循什么"
        />
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-slate-950">待确认经验</h2>
            <p className="mt-1 text-sm text-slate-500">来自用户返工与纠正，确认后才会影响这个员工在其他空间的工作。</p>
          </div>
          <span className="text-sm font-black text-amber-700">{groups.pending.length}</span>
        </div>
        <div className="grid gap-3">
          {groups.pending.map((rule) => (
            <article key={rule.id} className="rounded-lg border border-amber-200 bg-amber-50/50 p-4">
              {editor(rule)}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-semibold text-slate-400">累计发现 {rule.evidenceCount} 次</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => updateRule(rule, 'ignore')} disabled={busyId === rule.id} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-bold text-slate-500 hover:bg-white disabled:opacity-50"><X size={15} />忽略</button>
                  <button type="button" onClick={() => updateRule(rule, 'approve')} disabled={busyId === rule.id} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-950 px-3 text-sm font-bold text-white disabled:opacity-50">{busyId === rule.id ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}应用经验</button>
                </div>
              </div>
            </article>
          ))}
          {groups.pending.length === 0 && <div className="border-y border-black/[0.06] py-8 text-center text-sm font-semibold text-slate-400">目前没有待确认经验</div>}
        </div>
      </section>

      <section id="agent-growth-new-rule">
        <div className="mb-4">
          <h2 className="text-lg font-black text-slate-950">添加工作经验</h2>
          <p className="mt-1 text-sm text-slate-500">你直接添加的内容视为已确认，会立即用于这个员工之后的相关任务。</p>
        </div>
        <div className="grid gap-3 border-y border-black/[0.06] py-4">
          <div className="grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
            <select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value as RuleDraft['category'] }))} className="h-10 rounded-lg border border-black/[0.08] bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-slate-400">
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} className="h-10 min-w-0 rounded-lg border border-black/[0.08] px-3 text-sm font-bold outline-none focus:border-slate-400" placeholder="例如：公众号发布前检查" />
          </div>
          <textarea value={draft.instruction} onChange={(event) => setDraft((current) => ({ ...current, instruction: event.target.value }))} rows={3} className="w-full resize-y rounded-lg border border-black/[0.08] px-3 py-2 text-sm leading-6 outline-none focus:border-slate-400" placeholder="例如：交付公众号文章前，必须检查标题层级、图片链接和微信编辑器复制效果。" />
          <div className="flex justify-end">
            <button type="button" onClick={addRule} disabled={busyId === 'new' || !draft.title.trim() || !draft.instruction.trim()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-bold text-white disabled:opacity-40">{busyId === 'new' ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}添加经验</button>
          </div>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center gap-2"><Sparkles size={18} className="text-emerald-600" /><h2 className="text-lg font-black text-slate-950">已掌握的方法</h2></div>
        <div className="grid gap-3 md:grid-cols-2">
          {groups.active.map((rule) => {
            const editing = Boolean(edits[rule.id]);
            return (
              <article key={rule.id} className="rounded-lg border border-black/[0.07] bg-white p-4">
                {editing ? editor(rule) : <><div className="text-xs font-black text-emerald-700">{CATEGORY_LABELS[rule.category]}</div><h3 className="mt-1 font-black text-slate-900">{rule.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600">{rule.instruction}</p></>}
                <div className="mt-4 flex items-center justify-between gap-2 border-t border-black/[0.05] pt-3">
                  <span className="text-xs font-semibold text-slate-400">证据 {rule.evidenceCount} 次</span>
                  <div className="flex gap-1">
                    {editing ? <button type="button" title="保存" onClick={() => updateRule(rule, 'update')} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-slate-100"><Check size={15} /></button> : <button type="button" title="编辑" onClick={() => changeRule(rule, {})} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-slate-100"><Pencil size={15} /></button>}
                    <button type="button" title="停用" onClick={() => updateRule(rule, 'disable')} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><Ban size={15} /></button>
                    <button type="button" title="删除" onClick={() => deleteRule(rule)} className="flex h-8 w-8 items-center justify-center rounded-lg text-red-500 hover:bg-red-50"><Trash2 size={15} /></button>
                  </div>
                </div>
              </article>
            );
          })}
          {groups.active.length === 0 && <div className="py-8 text-sm font-semibold text-slate-400">这个员工还没有已确认的工作方法。</div>}
        </div>
        {groups.disabled.length > 0 && <div className="mt-5 border-t border-black/[0.06] pt-4"><div className="mb-3 text-sm font-black text-slate-500">已停用</div><div className="flex flex-wrap gap-2">{groups.disabled.map((rule) => <div key={rule.id} className="inline-flex max-w-full items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-bold text-slate-500"><span className="truncate">{rule.title}</span><button type="button" title="重新启用" onClick={() => updateRule(rule, 'enable')}><RotateCcw size={14} /></button><button type="button" title="删除" onClick={() => deleteRule(rule)}><Trash2 size={14} /></button></div>)}</div></div>}
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between gap-4"><div className="flex items-center gap-2"><BriefcaseBusiness size={18} className="text-blue-600" /><h2 className="text-lg font-black text-slate-950">工作履历</h2></div><span className="text-sm font-black text-slate-400">{profile?.experiences.length || 0}</span></div>
        <div className="divide-y divide-black/[0.06] border-y border-black/[0.06]">
          {profile?.experiences.map((experience) => (
            <article key={experience.id} className="py-4">
              <div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-slate-800">{experience.title}</h3><span className={`rounded px-2 py-0.5 text-xs font-black ${experience.outcome === 'ACCEPTED' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{experience.outcome === 'ACCEPTED' ? '已验收' : '待改进'}</span></div>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{experience.summary}</p>
              <div className="mt-2 flex items-center justify-between gap-3"><span className="text-xs font-semibold text-slate-400">{new Date(experience.updatedAt).toLocaleDateString('zh-CN')}</span>{experience.outcome === 'ACCEPTED' && <button type="button" onClick={() => promoteExperience(experience)} className="inline-flex items-center gap-1.5 text-xs font-black text-blue-700 hover:text-blue-900"><Plus size={13} />沉淀为经验</button>}</div>
            </article>
          ))}
          {!profile?.experiences.length && <div className="py-8 text-center text-sm font-semibold text-slate-400">完成并通过验收的空间任务会自动沉淀在这里</div>}
        </div>
      </section>
    </div>
  );
}
