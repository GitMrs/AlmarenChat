'use client';

import { useEffect, useState } from 'react';
import { Brain, Loader2, MessageCircleHeart, Plus, Save, Trash2 } from 'lucide-react';
import Avatar from '@/components/shared/Avatar';
import { assistant } from '@/lib/api';
import type { AssistantMemoryItem, PersonalAssistantProfile } from '@/types';

const EMPTY_PROFILE: PersonalAssistantProfile = { name: '', avatar: '', identity: '', soul: '', greeting: '' };

export default function PersonalAssistantSettings() {
  const [profile, setProfile] = useState<PersonalAssistantProfile>(EMPTY_PROFILE);
  const [memories, setMemories] = useState<AssistantMemoryItem[]>([]);
  const [newMemory, setNewMemory] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [memoryBusyId, setMemoryBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    assistant.get()
      .then((result) => {
        setProfile(result.profile);
        setMemories(result.memories);
      })
      .catch((reason: any) => setError(reason.message || '加载助理设置失败'))
      .finally(() => setLoading(false));
  }, []);

  const changeProfile = (field: keyof PersonalAssistantProfile, value: string) => {
    setProfile((current) => ({ ...current, [field]: value }));
    setNotice('');
  };
  const notifyAssistant = () => window.dispatchEvent(new Event('personal-assistant-updated'));

  const saveProfile = async () => {
    if (!profile.name.trim() || saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await assistant.updateProfile(profile);
      setProfile(result.profile);
      setNotice('助理设置已保存');
      notifyAssistant();
    } catch (reason: any) {
      setError(reason.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const addMemory = async () => {
    const content = newMemory.trim();
    if (!content || saving) return;
    setSaving(true);
    setError('');
    try {
      const result = await assistant.addMemory({ content });
      setMemories((items) => [result.memory, ...items]);
      setNewMemory('');
      notifyAssistant();
    } catch (reason: any) {
      setError(reason.message || '添加记忆失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleMemory = async (item: AssistantMemoryItem) => {
    setMemoryBusyId(item.id);
    setError('');
    try {
      const result = await assistant.updateMemory(item.id, { status: item.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' });
      setMemories((items) => items.map((memory) => memory.id === item.id ? result.memory : memory));
      notifyAssistant();
    } catch (reason: any) {
      setError(reason.message || '更新记忆失败');
    } finally {
      setMemoryBusyId(null);
    }
  };

  const deleteMemory = async (id: string) => {
    setMemoryBusyId(id);
    setError('');
    try {
      await assistant.deleteMemory(id);
      setMemories((items) => items.filter((item) => item.id !== id));
      notifyAssistant();
    } catch (reason: any) {
      setError(reason.message || '删除记忆失败');
    } finally {
      setMemoryBusyId(null);
    }
  };

  if (loading) return <div className="flex justify-center py-24 text-slate-400"><Loader2 className="animate-spin" size={24} /></div>;

  return (
    <section className="space-y-8">
      <div className="flex flex-col gap-4 border-b border-black/[0.06] pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-slate-400"><MessageCircleHeart size={16} />Personal Assistant</div>
          <h2 className="mt-1 text-2xl font-black text-slate-950">我的助理</h2>
        </div>
        <button type="button" onClick={saveProfile} disabled={saving || !profile.name.trim()} className="inline-flex h-10 w-fit items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white disabled:opacity-40">
          {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}保存设置
        </button>
      </div>
      {(error || notice) && <div className={`rounded-lg px-4 py-3 text-sm font-bold ${error ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'}`}>{error || notice}</div>}

      <div className="grid gap-6 border-b border-black/[0.06] pb-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          <h3 className="text-base font-black text-slate-950">助理档案</h3>
          <p className="mt-2 text-sm leading-6 text-slate-500">管理它的身份、相处方式和开场表达。</p>
        </div>
        <div className="space-y-5 rounded-lg border border-black/[0.07] bg-white p-5 shadow-sm">
          <div className="flex items-center gap-4">
            <Avatar src={profile.avatar || '💬'} alt={profile.name || '个人助理'} size="lg" />
            <label className="min-w-0 flex-1 text-xs font-black text-slate-500">形象
              <input value={profile.avatar || ''} onChange={(event) => changeProfile('avatar', event.target.value)} maxLength={500} className="mt-2 h-10 w-full rounded-lg border border-black/10 px-3 text-sm font-semibold outline-none focus:border-slate-400" placeholder="输入 emoji 或图片地址" />
            </label>
          </div>
          <label className="block text-xs font-black text-slate-500">称呼
            <input value={profile.name} onChange={(event) => changeProfile('name', event.target.value)} maxLength={24} className="mt-2 h-11 w-full rounded-lg border border-black/10 px-3 text-sm font-semibold outline-none focus:border-slate-400" />
          </label>
          <label className="block text-xs font-black text-slate-500">Identity
            <textarea value={profile.identity || ''} onChange={(event) => changeProfile('identity', event.target.value)} maxLength={1000} rows={3} className="mt-2 w-full resize-none rounded-lg border border-black/10 p-3 text-sm leading-6 outline-none focus:border-slate-400" placeholder="例如：了解我的工作和生活、帮助我梳理问题的个人助理" />
          </label>
          <label className="block text-xs font-black text-slate-500">Soul
            <textarea value={profile.soul || ''} onChange={(event) => changeProfile('soul', event.target.value)} maxLength={1000} rows={3} className="mt-2 w-full resize-none rounded-lg border border-black/10 p-3 text-sm leading-6 outline-none focus:border-slate-400" placeholder="例如：真诚、直接、少说套话，必要时提醒我忽略的问题" />
          </label>
          <label className="block text-xs font-black text-slate-500">欢迎语
            <textarea value={profile.greeting || ''} onChange={(event) => changeProfile('greeting', event.target.value)} maxLength={300} rows={2} className="mt-2 w-full resize-none rounded-lg border border-black/10 p-3 text-sm leading-6 outline-none focus:border-slate-400" />
          </label>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          <div className="flex items-center gap-2"><Brain size={17} /><h3 className="text-base font-black text-slate-950">长期记忆</h3></div>
          <p className="mt-2 text-sm leading-6 text-slate-500">这里只保存你确认过的信息。</p>
        </div>
        <div>
          <div className="flex gap-2 rounded-lg border border-black/[0.07] bg-white p-2 shadow-sm">
            <input value={newMemory} onChange={(event) => setNewMemory(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addMemory(); }} maxLength={500} className="h-10 min-w-0 flex-1 px-2 text-sm outline-none" placeholder="添加一条需要长期记住的信息" />
            <button type="button" onClick={addMemory} disabled={!newMemory.trim() || saving} aria-label="添加记忆" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-white disabled:opacity-40"><Plus size={17} /></button>
          </div>
          <div className="mt-3 space-y-2">
            {memories.length === 0 && <div className="border-y border-black/[0.06] py-12 text-center text-sm font-semibold text-slate-400">还没有长期记忆</div>}
            {memories.map((item) => {
              const busy = memoryBusyId === item.id;
              return (
                <div key={item.id} className="flex items-center gap-3 rounded-lg border border-black/[0.07] bg-white p-4">
                  <button type="button" role="switch" aria-checked={item.status === 'ACTIVE'} onClick={() => toggleMemory(item)} disabled={busy} className={`relative h-6 w-11 shrink-0 rounded-full transition ${item.status === 'ACTIVE' ? 'bg-emerald-600' : 'bg-slate-200'}`}>
                    <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition ${item.status === 'ACTIVE' ? 'left-6' : 'left-1'}`} />
                  </button>
                  <p className={`min-w-0 flex-1 text-sm font-semibold leading-6 ${item.status === 'ACTIVE' ? 'text-slate-700' : 'text-slate-400'}`}>{item.content}</p>
                  <button type="button" onClick={() => deleteMemory(item.id)} disabled={busy} aria-label="删除记忆" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40">{busy ? <Loader2 className="animate-spin" size={15} /> : <Trash2 size={15} />}</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
