'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Bot, Check, Eye, Loader2, Lock, MessageCircle, Palette, Sparkles, Wand2 } from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import LoginRequired from '@/components/auth/LoginRequired';
import { cn } from '@/lib/utils';
import { AGENT_CATEGORIES, AGENT_TONES, CATEGORY_COLORS } from '@/types';
import { agents, auth } from '@/lib/api';

const AVATAR_OPTIONS = ['🪄', '🤖', '💡', '📚', '🧭', '🎨', '🧠', '🛠️', '🌿', '🔥', '🌙', '☕', '🎯', '🧩', '📝', '🪐'];

const PURPOSE_PRESETS = [
  { category: '写作', tone: '详细', label: '写作搭子', prompt: '帮用户把想法整理成清晰、可发布、有风格的内容。' },
  { category: '编程', tone: '冷静', label: '编程教练', prompt: '帮助用户拆解代码问题，给出可靠、简洁、可执行的技术建议。' },
  { category: '学习', tone: '专业', label: '学习导师', prompt: '把复杂知识讲清楚，并用例子、练习和追问帮助用户理解。' },
  { category: '心理', tone: '温柔', label: '情绪陪伴', prompt: '温柔倾听用户的困扰，帮助用户梳理情绪和下一步选择。' },
];

function CreateAgentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editingAgentId = searchParams.get('agentId');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('写作');
  const [tone, setTone] = useState('详细');
  const [greeting, setGreeting] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('🪄');
  const [isPublic, setIsPublic] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [needsLogin, setNeedsLogin] = useState<boolean | null>(null);
  const [loadingAgent, setLoadingAgent] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('token')) {
      setNeedsLogin(true);
      return;
    }

    auth
      .me()
      .then(async () => {
        setNeedsLogin(false);
        if (!editingAgentId) return;

        setLoadingAgent(true);
        try {
          const result = await agents.get(editingAgentId);
          const agent = result.agent;
          setName(agent.name || '');
          setDescription(agent.description || '');
          setCategory(agent.category || '写作');
          setTone(agent.tone || '详细');
          setGreeting(agent.greeting || '');
          setSystemPrompt(agent.systemPrompt || '');
          setSelectedAvatar(agent.avatar || '🪄');
          setIsPublic(Boolean(agent.isPublic));
        } finally {
          setLoadingAgent(false);
        }
      })
      .catch(() => {
        localStorage.removeItem('token');
        setNeedsLogin(true);
      });
  }, [editingAgentId]);

  const categoryColor = CATEGORY_COLORS[category] || '#6366f1';
  const canCreate = name.trim().length > 0 && description.trim().length > 0 && category && tone;

  const finalGreeting = useMemo(() => {
    if (greeting.trim()) return greeting;
    if (!name.trim()) return '你好，我已经准备好了。告诉我你想完成什么，我们从第一步开始。';
    return `你好，我是 ${name}。告诉我你想完成什么，我们从第一步开始。`;
  }, [greeting, name]);

  const finalPrompt = useMemo(() => {
    if (systemPrompt.trim()) return systemPrompt;
    return `你是一个${category}类 AI Agent。你的语气风格是${tone}。你需要根据用户的问题给出清晰、具体、可执行的帮助。`;
  }, [category, systemPrompt, tone]);

  const applyPreset = (preset: (typeof PURPOSE_PRESETS)[number]) => {
    setCategory(preset.category);
    setTone(preset.tone);
    if (!description.trim()) setDescription(preset.prompt);
    if (!systemPrompt.trim()) {
      setSystemPrompt(`你是一个${preset.label}。${preset.prompt}回答要贴近普通用户，避免空泛，优先给出可以直接使用的结果。`);
    }
  };

  const handleSubmit = async () => {
    if (!canCreate || submitting) return;

    setSubmitting(true);
    try {
      const payload = {
        name,
        description,
        category,
        tone,
        greeting: finalGreeting,
        systemPrompt: finalPrompt,
        avatar: selectedAvatar,
        isPublic,
      };

      if (editingAgentId) {
        await agents.update(editingAgentId, payload);
      } else {
        await agents.create(payload);
      }
      router.push('/me');
    } catch (error) {
      console.error('Save agent failed:', error);
    } finally {
      setSubmitting(false);
    }
  };

  if (needsLogin === null || loadingAgent) {
    return (
      <AppShell>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="animate-spin text-slate-400" size={24} />
        </div>
      </AppShell>
    );
  }

  if (needsLogin) {
    return (
      <AppShell>
        <div className="py-8">
          <LoginRequired
            title="登录后创建你的 Agent"
            description="创建 Agent 会保存头像、设定、开场白和发布状态。登录后可以在我的空间继续维护。"
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="py-8">
        <section className="mb-8 rounded-[32px] border border-black/[0.06] bg-white/82 p-6 shadow-sm backdrop-blur sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white">
                <Wand2 size={16} />
                {editingAgentId ? 'Agent 编辑器' : 'Agent 创建器'}
              </div>
              <h1 className="text-4xl font-black leading-tight text-slate-950 sm:text-5xl">
                {editingAgentId ? '继续打磨你的 AI Agent。' : '像塑造一个角色一样，创建你的 AI Agent。'}
              </h1>
              <p className="mt-4 text-base leading-7 text-slate-500">
                {editingAgentId
                  ? '修改身份、语气、能力和开场白。保存后会更新你的 Agent 设置。'
                  : '给它身份、语气、能力和开场白。创建完成后，它会直接进入你的聊天空间。'}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 rounded-3xl bg-[#fbfaf7] p-3 text-center">
              {[
                ['1', '身份'],
                ['2', '能力'],
                ['3', '预览'],
              ].map(([index, label]) => (
                <div key={index} className="rounded-2xl bg-white px-5 py-4 shadow-sm">
                  <div className="text-lg font-black text-slate-950">{index}</div>
                  <div className="text-xs font-bold text-slate-400">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-6">
            <section className="rounded-[28px] border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white">
                  <Bot size={18} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-950">身份外观</h2>
                  <p className="text-sm text-slate-500">先让用户一眼知道它是谁。</p>
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="mb-3 block text-sm font-bold text-slate-700">头像</label>
                  <div className="grid grid-cols-8 gap-2 sm:flex sm:flex-wrap">
                    {AVATAR_OPTIONS.map((avatar) => (
                      <button
                        key={avatar}
                        onClick={() => setSelectedAvatar(avatar)}
                        className={cn(
                          'flex h-12 w-12 items-center justify-center rounded-2xl text-2xl transition',
                          selectedAvatar === avatar
                            ? 'scale-105 bg-slate-950 text-white shadow-md'
                            : 'bg-[#fbfaf7] hover:bg-slate-100'
                        )}
                      >
                        {avatar}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-slate-700">Agent 名称</span>
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="例如：小鹿写作官"
                      className="h-12 w-full rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-slate-700">一句话定位</span>
                    <input
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="它最擅长帮用户做什么？"
                      className="h-12 w-full rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                    />
                  </label>
                </div>
              </div>
            </section>

            <section className="rounded-[28px] border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                  <Palette size={18} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-950">用途和性格</h2>
                  <p className="text-sm text-slate-500">选择它的领域、语气和默认行为。</p>
                </div>
              </div>

              <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {PURPOSE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => applyPreset(preset)}
                    className="rounded-2xl border border-black/[0.06] bg-[#fbfaf7] p-4 text-left transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md"
                  >
                    <div className="text-sm font-black text-slate-950">{preset.label}</div>
                    <div className="mt-1 text-xs leading-5 text-slate-500">{preset.prompt}</div>
                  </button>
                ))}
              </div>

              <div className="grid gap-5 lg:grid-cols-2">
                <div>
                  <label className="mb-3 block text-sm font-bold text-slate-700">分类</label>
                  <div className="flex flex-wrap gap-2">
                    {AGENT_CATEGORIES.filter((item) => item !== '全部').map((item) => {
                      const color = CATEGORY_COLORS[item] || '#6366f1';
                      const selected = category === item;
                      return (
                        <button
                          key={item}
                          onClick={() => setCategory(item)}
                          className={cn(
                            'rounded-full border px-4 py-2 text-sm font-bold transition',
                            selected ? 'text-white shadow-sm' : 'border-black/[0.06] bg-[#fbfaf7] text-slate-600 hover:bg-white'
                          )}
                          style={selected ? { backgroundColor: color, borderColor: color } : undefined}
                        >
                          {item}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="mb-3 block text-sm font-bold text-slate-700">语气</label>
                  <div className="flex flex-wrap gap-2">
                    {AGENT_TONES.map((item) => (
                      <button
                        key={item}
                        onClick={() => setTone(item)}
                        className={cn(
                          'rounded-full border px-4 py-2 text-sm font-bold transition',
                          tone === item
                            ? 'border-slate-950 bg-slate-950 text-white shadow-sm'
                            : 'border-black/[0.06] bg-[#fbfaf7] text-slate-600 hover:bg-white'
                        )}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[28px] border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                  <MessageCircle size={18} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-950">对话能力</h2>
                  <p className="text-sm text-slate-500">开场白和系统提示词决定它怎么说话。</p>
                </div>
              </div>

              <div className="space-y-4">
                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-700">开场白</span>
                  <textarea
                    value={greeting}
                    onChange={(event) => setGreeting(event.target.value)}
                    placeholder={finalGreeting}
                    rows={3}
                    className="w-full resize-none rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 py-3 text-sm font-medium leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-bold text-slate-700">系统提示词</span>
                  <textarea
                    value={systemPrompt}
                    onChange={(event) => setSystemPrompt(event.target.value)}
                    placeholder={finalPrompt}
                    rows={6}
                    className="w-full resize-none rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 py-3 font-mono text-sm leading-6 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                  />
                </label>
              </div>
            </section>
          </div>

          <aside className="lg:sticky lg:top-24 lg:self-start">
            <div className="overflow-hidden rounded-[32px] border border-black/[0.06] bg-white shadow-xl">
              <div className="h-2" style={{ backgroundColor: categoryColor }} />
              <div className="p-6">
                <div className="mb-5 flex items-center justify-between">
                  <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-500">
                    <Eye size={14} />
                    实时预览
                  </div>
                  <button
                    onClick={() => setIsPublic(!isPublic)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition',
                      isPublic ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                    )}
                  >
                    {isPublic ? <Check size={14} /> : <Lock size={14} />}
                    {isPublic ? '公开' : '私有'}
                  </button>
                </div>

                <div className="rounded-[28px] bg-[#fbfaf7] p-5">
                  <div className="mb-5 flex items-start gap-4">
                    <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white text-4xl shadow-sm">
                      {selectedAvatar}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-xl font-black text-slate-950">{name || '未命名 Agent'}</h3>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="rounded-full px-2.5 py-1 text-xs font-bold text-white" style={{ backgroundColor: categoryColor }}>
                          {category}
                        </span>
                        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-600">
                          {tone}
                        </span>
                      </div>
                    </div>
                  </div>

                  <p className="min-h-[48px] text-sm leading-6 text-slate-600">
                    {description || '写一句话，让用户知道这个 Agent 最擅长什么。'}
                  </p>

                  <div className="mt-5 rounded-2xl bg-white p-4">
                    <div className="mb-1 text-xs font-bold text-slate-400">开场白</div>
                    <p className="text-sm leading-6 text-slate-700">“{finalGreeting}”</p>
                  </div>

                  <div className="mt-3 rounded-2xl bg-white p-4">
                    <div className="mb-1 text-xs font-bold text-slate-400">行为设定</div>
                    <p className="line-clamp-4 font-mono text-xs leading-5 text-slate-500">{finalPrompt}</p>
                  </div>
                </div>

                <button
                  onClick={handleSubmit}
                  disabled={!canCreate || submitting}
                  className={cn(
                    'mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-black transition',
                    canCreate && !submitting
                      ? 'bg-slate-950 text-white shadow-sm hover:-translate-y-0.5 hover:shadow-lg'
                      : 'bg-slate-100 text-slate-400'
                  )}
                >
                  <Sparkles size={16} />
                  {submitting ? '保存中...' : editingAgentId ? '保存修改' : '创建并开始聊天'}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

export default function CreateAgentPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <div className="flex items-center justify-center py-24">
            <Loader2 className="animate-spin text-slate-400" size={24} />
          </div>
        </AppShell>
      }
    >
      <CreateAgentContent />
    </Suspense>
  );
}
