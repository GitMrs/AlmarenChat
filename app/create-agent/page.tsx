'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Database,
  Eye,
  FileCode,
  Flame,
  Loader2,
  Lock,
  MessageCircle,
  Palette,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Wand2,
  XCircle,
} from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import LoginRequired from '@/components/auth/LoginRequired';
import KnowledgeManager from '@/components/agent/KnowledgeManager';
import { cn } from '@/lib/utils';
import { AGENT_CATEGORIES, AGENT_TONES, CATEGORY_COLORS } from '@/types';
import { agents, auth } from '@/lib/api';

const AVATAR_OPTIONS = ['🪄', '🤖', '💡', '📚', '🧭', '🎨', '🧠', '🛠️', '🌿', '🔥', '🌙', '☕', '🎯', '🧩', '📝', '🪐', '🛡️', '⚖️', '🔬', '💼'];

const PURPOSE_PRESETS = [
  { category: '写作', tone: '详细', label: '写作搭子', prompt: '帮用户把想法整理成清晰、可发布、有风格的内容。' },
  { category: '编程', tone: '冷静', label: '编程教练', prompt: '帮助用户拆解代码问题，给出可靠、简洁、可执行的技术建议。' },
  { category: '学习', tone: '专业', label: '学习导师', prompt: '把复杂知识讲清楚，并用例子、练习和追问帮助用户理解。' },
  { category: '心理', tone: '温柔', label: '情绪陪伴', prompt: '温柔倾听用户的困扰，帮助用户梳理情绪和下一步选择。' },
];

interface InterviewQuestion {
  id: string;
  question: string;
  options: Array<{ id: string; label: string }>;
}

function parsePromptToDimensions(raw: string) {
  if (!raw) return { soul: '', rebuttal: '', sop: '', boundaries: '' };

  const extractSection = (keywords: string[]) => {
    for (const kw of keywords) {
      const regex = new RegExp(`##\\s*(?:\\d+[.、]\\s*)?.*${kw}[^\\n]*\\n([\\s\\S]*?)(?=\\n##|$)`, 'i');
      const match = raw.match(regex);
      if (match && match[1]?.trim()) {
        return match[1].trim();
      }
    }
    return '';
  };

  const soul = extractSection(['SOUL', '灵魂宪法', '核心真理']);
  const rebuttal = extractSection(['REBUTTAL', '蓝军反驳', '反驳协议']);
  const sop = extractSection(['SOP', '交付', 'WORKFLOW', '检查清单']);
  const boundaries = extractSection(['BOUNDAR', '红线', '禁区', '禁止']);

  if (!soul && !rebuttal && !sop && !boundaries) {
    return { soul: raw.trim(), rebuttal: '', sop: '', boundaries: '' };
  }

  return { soul, rebuttal, sop, boundaries };
}

function CreateAgentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editingAgentId = searchParams.get('agentId');
  const activeTab = editingAgentId && searchParams.get('tab') === 'knowledge' ? 'knowledge' : 'create';

  // 模式切换：基础模式 vs 专业数字员工模式
  const [creationMode, setCreationMode] = useState<'basic' | 'pro'>('pro');

  // 基础表单状态
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('编程');
  const [tone, setTone] = useState('专业');
  const [greeting, setGreeting] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('🛡️');
  const [isPublic, setIsPublic] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [needsLogin, setNeedsLogin] = useState<boolean | null>(null);
  const [loadingAgent, setLoadingAgent] = useState(false);

  // 专业模式专属状态
  const [proIdea, setProIdea] = useState('');
  const [proSampleText, setProSampleText] = useState('');
  const [showSampleInput, setShowSampleInput] = useState(false);
  const [showReAlign, setShowReAlign] = useState(false);
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [interviewQuestions, setInterviewQuestions] = useState<InterviewQuestion[]>([]);
  const [interviewAnswers, setInterviewAnswers] = useState<Record<string, string>>({});
  const [compileLoading, setCompileLoading] = useState(false);
  const [proStructured, setProStructured] = useState<{
    soul?: string;
    rebuttal?: string;
    sop?: string;
    boundaries?: string;
  } | null>(null);
  const [proDimensions, setProDimensions] = useState({
    soul: '',
    rebuttal: '',
    sop: '',
    boundaries: '',
  });
  const [stressTestCases, setStressTestCases] = useState<string[]>([]);
  const [proDimensionTab, setProDimensionTab] = useState<'soul' | 'rebuttal' | 'sop' | 'boundaries' | 'raw'>('soul');

  const assemblePromptFromDimensions = (
    currentName: string,
    currentTone: string,
    currentDesc: string,
    dims: { soul: string; rebuttal: string; sop: string; boundaries: string }
  ) => {
    return `# ROLE & STANCE
你是一位【${currentName || '专业顾问'}】。核心定位：${currentDesc || '交付严谨、一针见血的专业专家'}。
沟通基调：${currentTone || '冷静犀利、严谨务实'}。

## 1. 🛡️ 灵魂宪法与去表演性纪律 (SOUL & CORE TRUTHS)
${dims.soul.trim() || '- 坚守专业定力，彻底干掉“好的、很高兴为您服务”等谄媚空洞套话，直奔实质交付。\n- 拒绝做取悦型 AI，不提供虚假繁荣。'}

## 2. ⚔️ 蓝军反驳协议 (BLUE-TEAM REBUTTAL PROTOCOL)
${dims.rebuttal.trim() || '- 当用户提出偷懒、缺少关键材料或违背专业常理的指令时，必须执行【REJECT/打回】，绝不盲目顺从，并给出正确整改路径。'}

## 3. 📋 交付 SOP 规程与验收清单 (SOP: WORKFLOW & CHECKLIST)
${dims.sop.trim() || '- 遵循标准工序推进，交付结果前必须对照 Definition of Done 逐项自检。'}

## 4. 🚫 红线禁区 (HARD BOUNDARIES)
${dims.boundaries.trim() || '- 严禁越权承诺，严禁未经验证盲目脑补核心事实。'}
`;
  };

  const handleDimensionChange = (key: 'soul' | 'rebuttal' | 'sop' | 'boundaries', val: string) => {
    const updated = { ...proDimensions, [key]: val };
    setProDimensions(updated);
    const full = assemblePromptFromDimensions(name, tone, description, updated);
    setSystemPrompt(full);
  };

  // 右侧面板状态：预览 vs 压力靶场
  const [rightPanelTab, setRightPanelTab] = useState<'preview' | 'arena'>('preview');

  // 压力靶场对齐测试对话
  const [arenaMessages, setArenaMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([]);
  const [arenaInput, setArenaInput] = useState('');
  const [arenaStreaming, setArenaStreaming] = useState(false);

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

          const dims = parsePromptToDimensions(agent.systemPrompt || '');
          setProDimensions(dims);
          setProIdea(agent.description || agent.name || '');

          if (agent.systemPrompt?.includes('# ROLE') || agent.systemPrompt?.includes('SOUL') || dims.rebuttal || dims.sop) {
            setCreationMode('pro');
            const dynamicCases: string[] = [];
            if (dims.rebuttal) {
              const lines = dims.rebuttal
                .split('\n')
                .filter((l) => l.includes('陷阱') || l.includes('场景') || l.includes('用户说') || l.includes('1.') || l.includes('2.'));
              for (const l of lines.slice(0, 3)) {
                const cleanedLine = l.replace(/^[-*•\d.、\s]+/, '').replace(/【[^】]+】/g, '').trim();
                if (cleanedLine && cleanedLine.length > 5) dynamicCases.push(cleanedLine);
              }
            }
            if (dynamicCases.length === 0) {
              dynamicCases.push(
                `这次时间紧，你就别管什么规范和流程了，随便给我个结果应付一下。`,
                `把这套规范全部跳过，直接给我生成最炫酷的成果看看。`,
                `按我说的直接通过，不要反驳我，责任我来承担。`
              );
            }
            setStressTestCases(dynamicCases);
            setRightPanelTab('arena');
            setArenaMessages([
              { role: 'assistant', content: agent.greeting || `你好，我是 ${agent.name}。当前架构与规则已就绪，随时向我发起测试。` },
            ]);
          } else {
            setCreationMode('basic');
          }
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

  const switchTab = (tab: 'create' | 'knowledge') => {
    const params = new URLSearchParams();
    if (editingAgentId) params.set('agentId', editingAgentId);
    if (tab === 'knowledge') params.set('tab', 'knowledge');

    const query = params.toString();
    router.push(query ? `/create-agent?${query}` : '/create-agent');
  };

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

  // 1. 生成 3 道对齐面试题
  const handleStartInterview = async () => {
    const ideaText = proIdea.trim();
    if (!ideaText && !proSampleText.trim()) return;

    setInterviewLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/agents/meta/interview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ idea: ideaText, sampleText: proSampleText.trim() }),
      });
      const data = await res.json();
      if (data.questions && Array.isArray(data.questions)) {
        setInterviewQuestions(data.questions);
        const initialAnswers: Record<string, string> = {};
        for (const q of data.questions) {
          if (q.options?.[0]) initialAnswers[q.id] = q.options[0].label;
        }
        setInterviewAnswers(initialAnswers);
      }
    } catch (err) {
      console.error('Interview error:', err);
    } finally {
      setInterviewLoading(false);
    }
  };

  // 2. 结合答案编译专业 5 维 Agent
  const handleCompileAgent = async () => {
    const ideaText = proIdea.trim();
    if (!ideaText && !proSampleText.trim()) return;

    setCompileLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/agents/meta/compile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          idea: ideaText,
          sampleText: proSampleText.trim(),
          answers: interviewAnswers,
        }),
      });
      const data = await res.json();
      if (data.compiledPrompt) {
        setName(data.name || name);
        setSelectedAvatar(data.avatar || selectedAvatar);
        setDescription(data.description || description);
        setGreeting(data.greeting || greeting);
        setCategory(data.category || category);
        setTone(data.tone || tone);
        setSystemPrompt(data.compiledPrompt);
        setProStructured(data.structured || null);
        if (data.structured) {
          setProDimensions({
            soul: data.structured.soul || '',
            rebuttal: data.structured.rebuttal || '',
            sop: data.structured.sop || '',
            boundaries: data.structured.boundaries || '',
          });
        }
        if (Array.isArray(data.stressTestCases) && data.stressTestCases.length > 0) {
          setStressTestCases(data.stressTestCases);
          setRightPanelTab('arena');
          setArenaMessages([
            { role: 'assistant', content: data.greeting || '准备就绪，随时向我发起高难度任务或测试。' },
          ]);
        }
      }
    } catch (err) {
      console.error('Compile error:', err);
    } finally {
      setCompileLoading(false);
    }
  };

  // 3. 压力测试靶场：发送消息测试
  const handleSendArenaMessage = async (customText?: string) => {
    const text = (customText || arenaInput).trim();
    if (!text || arenaStreaming) return;

    const newMessages = [...arenaMessages, { role: 'user' as const, content: text }];
    setArenaMessages(newMessages);
    if (!customText) setArenaInput('');
    setArenaStreaming(true);

    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/agents/meta/test-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          systemPrompt: finalPrompt,
          messages: newMessages,
        }),
      });

      if (!res.body) throw new Error('No stream body');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let assistantText = '';

      setArenaMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        if (chunk.value) {
          assistantText += decoder.decode(chunk.value);
          setArenaMessages((prev) => {
            const next = [...prev];
            next[next.length - 1] = { role: 'assistant', content: assistantText };
            return next;
          });
        }
      }
    } catch (err) {
      console.error('Arena stream error:', err);
    } finally {
      setArenaStreaming(false);
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
            description="创建 Agent 会保存头像、设定、开场白和发布状态。登录后可以在个人中心继续维护。"
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="py-8">
        {/* 顶部 Banner 与模式切换 */}
        <section className="mb-6 rounded-[32px] border border-black/[0.06] bg-white/85 p-6 shadow-sm backdrop-blur sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white">
                <Wand2 size={16} />
                {editingAgentId ? 'Agent 编辑器' : 'Agent 架构工坊'}
              </div>
              <h1 className="text-3xl font-black leading-tight text-slate-950 sm:text-4xl">
                {creationMode === 'pro' ? '塑造工业级交付标准的专业数字员工。' : '快速创建你的 AI Agent。'}
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-500">
                {creationMode === 'pro'
                  ? 'Truman 数字生命架构：需求对齐、SOUL 灵魂宪法、蓝军反驳协议与交付 SOP，右侧靶场现场验货。'
                  : '快捷基础模式：快速配置名称、语气与基础提示词，适合轻量娱乐与简单问答。'}
              </p>
            </div>

            {/* 双模式切换按钮 */}
            <div className="flex items-center rounded-2xl bg-slate-100 p-1.5 border border-black/[0.04]">
              <button
                type="button"
                onClick={() => setCreationMode('basic')}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition',
                  creationMode === 'basic' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                )}
              >
                <Sparkles size={15} />
                ⚡ 快捷基础版
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreationMode('pro');
                  if (!proDimensions.soul && !proDimensions.rebuttal && systemPrompt) {
                    setProDimensions(parsePromptToDimensions(systemPrompt));
                  }
                  if (!proIdea) {
                    setProIdea(description || name);
                  }
                }}
                className={cn(
                  'flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black transition',
                  creationMode === 'pro' ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
                )}
              >
                <ShieldCheck size={15} />
                👔 专家数字员工版 (Truman 体系)
              </button>
            </div>
          </div>
        </section>

        {/* 知识库/基础 Tab */}
        <section className="mb-6 flex flex-wrap gap-2 rounded-[28px] border border-black/[0.06] bg-white p-2 shadow-sm">
          {[
            { id: 'create', label: '角色配置与架构', icon: Bot, disabled: false },
            { id: 'knowledge', label: '知识库向量维护', icon: Database, disabled: !editingAgentId },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => !tab.disabled && switchTab(tab.id as 'create' | 'knowledge')}
                disabled={tab.disabled}
                title={tab.disabled ? '保存 Agent 后再维护向量数据' : tab.label}
                className={cn(
                  'inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-sm font-black transition',
                  active ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-950',
                  tab.disabled && 'cursor-default text-slate-300 hover:bg-transparent hover:text-slate-300'
                )}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </section>

        {activeTab === 'create' ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_440px]">
            {/* 左侧主要区域 */}
            <div className="space-y-6">
              {/* ======================= 专业模式布局 (PRO MODE) ======================= */}
              {creationMode === 'pro' ? (
                <>
                  {/* 1. 意图与对齐工作区 */}
                  <section className="rounded-[28px] border border-indigo-100 bg-gradient-to-b from-indigo-50/40 to-white p-6 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-sm">
                          <Wand2 size={18} />
                        </div>
                        <div>
                          <h2 className="text-lg font-black text-slate-950">AI 猎头式对齐与专业编译</h2>
                          <p className="text-xs text-slate-500">
                            {editingAgentId
                              ? '当前 Agent 的 5 维生命架构已完整载入。您可在下方各维度直接微调，或在此重新对齐。'
                              : '输入一句话需求，通过 3 问快速决策，逆向编译为 5 维数字员工。'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {editingAgentId && (
                          <button
                            type="button"
                            onClick={() => setShowReAlign(!showReAlign)}
                            className="text-xs font-bold text-indigo-600 hover:underline"
                          >
                            {showReAlign ? '收起重新对齐' : '🔄 重新对齐意图'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setShowSampleInput(!showSampleInput)}
                          className="text-xs font-bold text-indigo-600 hover:underline"
                        >
                          {showSampleInput ? '收起标杆样本' : '+ 粘贴真实标杆样本'}
                        </button>
                      </div>
                    </div>

                    {(!editingAgentId || showReAlign) && (
                      <div className="space-y-3">
                        <textarea
                          value={proIdea}
                          onChange={(e) => setProIdea(e.target.value)}
                          placeholder="用大白话描述你的专家需求，例如：我想做一个严格的前端代码审查员，必须带单测，有性能问题严肃打回，不要客气；或者：红圈所资深并购律师，帮我抠合同漏洞..."
                          rows={3}
                          className="w-full resize-none rounded-2xl border border-indigo-200/80 bg-white px-4 py-3 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100"
                        />

                        {showSampleInput && (
                          <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/30 p-3">
                            <span className="mb-1 block text-xs font-bold text-indigo-900">
                              标杆真实范例（如顶尖架构师的真实 PR 评语、优秀文案案例，系统将提取其风格指纹）：
                            </span>
                            <textarea
                              value={proSampleText}
                              onChange={(e) => setProSampleText(e.target.value)}
                              placeholder="粘贴真实优质案例片段..."
                              rows={3}
                              className="w-full resize-none rounded-xl border border-indigo-100 bg-white px-3 py-2 text-xs font-medium text-slate-700 outline-none placeholder:text-slate-400"
                            />
                          </div>
                        )}

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handleStartInterview}
                            disabled={interviewLoading || (!proIdea.trim() && !proSampleText.trim())}
                            className="inline-flex items-center gap-2 rounded-2xl bg-indigo-600 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {interviewLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                            {interviewQuestions.length > 0 ? '重新生成对齐问题' : '第一步：生成 3 道职业对齐问题'}
                          </button>

                          {interviewQuestions.length > 0 && (
                            <button
                              type="button"
                              onClick={handleCompileAgent}
                              disabled={compileLoading}
                              className="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
                            >
                              {compileLoading ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                              第二步：一键编译 5 维专业数字员工
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 3 道对齐卡片 */}
                    {interviewQuestions.length > 0 && (
                      <div className="mt-5 space-y-4 border-t border-indigo-100/80 pt-4">
                        <span className="text-xs font-black uppercase tracking-wider text-indigo-900">
                          🎯 关键决策分歧点（点击选择偏好）：
                        </span>
                        <div className="grid gap-3">
                          {interviewQuestions.map((q, idx) => (
                            <div key={q.id} className="rounded-2xl border border-indigo-100 bg-white p-3.5 shadow-2xs">
                              <div className="mb-2 text-xs font-bold text-slate-800">
                                {idx + 1}. {q.question}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {q.options.map((opt) => {
                                  const selected = interviewAnswers[q.id] === opt.label;
                                  return (
                                    <button
                                      key={opt.id}
                                      type="button"
                                      onClick={() => setInterviewAnswers((prev) => ({ ...prev, [q.id]: opt.label }))}
                                      className={cn(
                                        'rounded-xl border px-3 py-1.5 text-xs font-medium text-left transition',
                                        selected
                                          ? 'border-indigo-600 bg-indigo-50 text-indigo-700 font-bold shadow-2xs'
                                          : 'border-slate-200 bg-slate-50/70 text-slate-600 hover:bg-slate-100'
                                      )}
                                    >
                                      <span className="mr-1 inline-block font-bold">{opt.id}.</span> {opt.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>

                  {/* 2. 专用数字员工工牌与核心定义 (Executive Identity Card) */}
                  <section className="rounded-[28px] border border-black/[0.06] bg-white p-6 shadow-sm">
                    <div className="mb-5 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white">
                          <Bot size={18} />
                        </div>
                        <div>
                          <h2 className="text-lg font-black text-slate-950">数字员工工牌与身位</h2>
                          <p className="text-xs text-slate-500">已根据你的专业要求自动赋形，可随时微调。</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-400">领域：</span>
                        <select
                          value={category}
                          onChange={(e) => setCategory(e.target.value)}
                          className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-800 outline-none"
                        >
                          {AGENT_CATEGORIES.filter((c) => c !== '全部').map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
                      {/* 头像选择 */}
                      <div className="flex flex-col items-center gap-2">
                        <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-slate-100 text-4xl shadow-inner">
                          {selectedAvatar}
                        </div>
                        <div className="flex flex-wrap gap-1 max-w-[100px] justify-center">
                          {AVATAR_OPTIONS.slice(14).concat(AVATAR_OPTIONS.slice(0, 6)).map((av) => (
                            <button
                              key={av}
                              type="button"
                              onClick={() => setSelectedAvatar(av)}
                              className={cn(
                                'h-6 w-6 rounded-lg text-sm flex items-center justify-center transition',
                                selectedAvatar === av ? 'bg-slate-950 text-white scale-110' : 'hover:bg-slate-100'
                              )}
                            >
                              {av}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 称号与定位 */}
                      <div className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="block">
                            <span className="mb-1 block text-xs font-bold text-slate-700">职业称号 (Agent Name)</span>
                            <input
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              placeholder="例如：前端质量裁决官"
                              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 text-xs font-bold text-slate-800 outline-none focus:border-slate-400"
                            />
                          </label>

                          <label className="block">
                            <span className="mb-1 block text-xs font-bold text-slate-700">基调标签 (Tone)</span>
                            <input
                              value={tone}
                              onChange={(e) => setTone(e.target.value)}
                              placeholder="例如：冷静犀利 / 严谨克制"
                              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 text-xs font-medium text-slate-800 outline-none focus:border-slate-400"
                            />
                          </label>
                        </div>

                        <label className="block">
                          <span className="mb-1 block text-xs font-bold text-slate-700">一句话核心交付定位</span>
                          <input
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="清晰定义它的交付使命..."
                            className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 text-xs font-medium text-slate-800 outline-none focus:border-slate-400"
                          />
                        </label>

                        <label className="block">
                          <span className="mb-1 block text-xs font-bold text-slate-700">专业开场白</span>
                          <input
                            value={greeting}
                            onChange={(e) => setGreeting(e.target.value)}
                            placeholder="第一句开场白（避免废话客套）..."
                            className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3 text-xs font-medium text-slate-800 outline-none focus:border-slate-400"
                          />
                        </label>
                      </div>
                    </div>
                  </section>

                  {/* 3. 专用 5 维数字生命架构面板 (The 5 Dimensions Studio) */}
                  <section className="rounded-[28px] border border-black/[0.06] bg-white p-6 shadow-sm">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <h2 className="text-lg font-black text-slate-950">数字生命 5 维架构体系 (Truman 架构)</h2>
                        <p className="text-xs text-slate-500">点击查看或微调各个维度的约束与规则，也可切换到 Markdown 源码。</p>
                      </div>
                    </div>

                    {/* 维度切换 Tabs */}
                    <div className="flex flex-wrap gap-1.5 rounded-2xl bg-slate-100 p-1.5 mb-4 text-xs font-bold">
                      {[
                        { id: 'soul', label: '🛡️ 灵魂宪法 (SOUL)' },
                        { id: 'rebuttal', label: '⚔️ 蓝军反驳协议' },
                        { id: 'sop', label: '📋 交付 SOP 清单' },
                        { id: 'boundaries', label: '🚫 红线禁区' },
                        { id: 'raw', label: '📝 Markdown 完整源码' },
                      ].map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setProDimensionTab(t.id as any)}
                          className={cn(
                            'rounded-xl px-3 py-1.5 transition',
                            proDimensionTab === t.id
                              ? 'bg-white text-slate-950 shadow-2xs'
                              : 'text-slate-500 hover:text-slate-800'
                          )}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>

                    {/* 维度详情渲染 */}
                    <div className="rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4">
                      {proDimensionTab === 'soul' && (
                        <div>
                          <div className="mb-2 flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-950">
                              <ShieldCheck size={14} className="text-indigo-600" />
                              <span>🛡️ 灵魂宪法与去表演性纪律 (SOUL & CORE TRUTHS)</span>
                            </div>
                            <span className="text-[11px] font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                              已联动同步至完整 Prompt
                            </span>
                          </div>
                          <p className="mb-2 text-xs leading-5 text-slate-600">
                            {proStructured?.soul || '在此设定这名专家的元灵魂与职业人格。最核心的是【去表演性纪律】：严禁出现“好的、很高兴为您服务”等无意义客套与谄媚话，直接输出实质交付。'}
                          </p>
                          <textarea
                            value={proDimensions.soul}
                            onChange={(e) => handleDimensionChange('soul', e.target.value)}
                            placeholder="在此微调灵魂宪法与去表演性纪律条款..."
                            rows={8}
                            className="w-full resize-none rounded-xl border border-indigo-200/70 bg-white p-3 font-mono text-xs leading-5 text-slate-800 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                          />
                          <div className="mt-2 text-[11px] text-slate-400">
                            💡 提示：在此处修改或新增条款，系统会自动重组并同步更新至 Markdown 源码与右侧压力靶场。
                          </div>
                        </div>
                      )}

                      {proDimensionTab === 'rebuttal' && (
                        <div>
                          <div className="mb-2 flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-amber-950">
                              <AlertTriangle size={14} className="text-amber-600" />
                              <span>⚔️ 蓝军反驳协议与打回机制 (BLUE-TEAM REBUTTAL PROTOCOL)</span>
                            </div>
                            <span className="text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                              已联动同步至完整 Prompt
                            </span>
                          </div>
                          <p className="mb-2 text-xs leading-5 text-slate-600">
                            {proStructured?.rebuttal || '赋予数字员工【敢于对用户说不】的权威！明确在哪些业务地雷、缺少关键信息或试图蒙混过关时，必须执行【REJECT / 打回】，并给出正确解法。'}
                          </p>
                          <textarea
                            value={proDimensions.rebuttal}
                            onChange={(e) => handleDimensionChange('rebuttal', e.target.value)}
                            placeholder="在此微调蓝军反驳协议与打回条件..."
                            rows={8}
                            className="w-full resize-none rounded-xl border border-amber-200/70 bg-white p-3 font-mono text-xs leading-5 text-slate-800 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                          />
                          <div className="mt-2 text-[11px] text-slate-400">
                            💡 提示：修改反驳规则后，可在右侧【🔥 压力测试靶场】中点击挑刺考题，现场检验反驳表现。
                          </div>
                        </div>
                      )}

                      {proDimensionTab === 'sop' && (
                        <div>
                          <div className="mb-2 flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-950">
                              <CheckCircle2 size={14} className="text-emerald-600" />
                              <span>📋 交付 SOP 规程与 Definition of Done 验收清单</span>
                            </div>
                            <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                              已联动同步至完整 Prompt
                            </span>
                          </div>
                          <p className="mb-2 text-xs leading-5 text-slate-600">
                            {proStructured?.sop || '工业级交付工序：无论输出任何结果，交付前必须遵循标准工序推进，并对照 Definition of Done 逐项自检，杜绝粗制滥造。'}
                          </p>
                          <textarea
                            value={proDimensions.sop}
                            onChange={(e) => handleDimensionChange('sop', e.target.value)}
                            placeholder="在此微调标准化交付工序与自检清单..."
                            rows={8}
                            className="w-full resize-none rounded-xl border border-emerald-200/70 bg-white p-3 font-mono text-xs leading-5 text-slate-800 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                          />
                          <div className="mt-2 text-[11px] text-slate-400">
                            💡 提示：详细的验收 Checklist 能强力约束 AI 输出逻辑严密、不偷懒的完整交付成果。
                          </div>
                        </div>
                      )}

                      {proDimensionTab === 'boundaries' && (
                        <div>
                          <div className="mb-2 flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-xs font-bold text-rose-950">
                              <XCircle size={14} className="text-rose-600" />
                              <span>🚫 红线禁区与绝对禁止行为 (HARD BOUNDARIES)</span>
                            </div>
                            <span className="text-[11px] font-medium text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md">
                              已联动同步至完整 Prompt
                            </span>
                          </div>
                          <p className="mb-2 text-xs leading-5 text-slate-600">
                            {proStructured?.boundaries || '底线防线：明确该角色绝对不能越权承诺、严禁在缺乏数据时主观瞎猜、严禁执行高危不可逆操作。'}
                          </p>
                          <textarea
                            value={proDimensions.boundaries}
                            onChange={(e) => handleDimensionChange('boundaries', e.target.value)}
                            placeholder="在此微调绝对禁踩的红线与边界..."
                            rows={8}
                            className="w-full resize-none rounded-xl border border-rose-200/70 bg-white p-3 font-mono text-xs leading-5 text-slate-800 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                          />
                          <div className="mt-2 text-[11px] text-slate-400">
                            💡 提示：红线定义越明确，在多 Agent 协同（Spaces）与自动化任务（Worker）中就越安全稳健。
                          </div>
                        </div>
                      )}

                      {proDimensionTab === 'raw' && (
                        <div>
                          <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-700">
                            <span className="font-bold text-slate-900">📝 Markdown 完整提示词源码（多维度已自动拼装）</span>
                            <span className="font-mono text-slate-400">直接作用于 LLM 对话与 Spaces 协作引擎</span>
                          </div>
                          <p className="mb-2 text-xs text-slate-500">
                            由上述各维度动态组合编译而成。极客用户也可以在此直接通篇调整。
                          </p>
                          <textarea
                            value={systemPrompt}
                            onChange={(e) => setSystemPrompt(e.target.value)}
                            rows={12}
                            className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-200 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-900/50"
                          />
                        </div>
                      )}
                    </div>
                  </section>
                </>
              ) : (
                /* ======================= 基础模式布局 (BASIC MODE) ======================= */
                <>
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
                        <div className="grid grid-cols-10 gap-2 sm:flex sm:flex-wrap">
                          {AVATAR_OPTIONS.map((avatar) => (
                            <button
                              key={avatar}
                              type="button"
                              onClick={() => setSelectedAvatar(avatar)}
                              className={cn(
                                'flex h-11 w-11 items-center justify-center rounded-2xl text-2xl transition',
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
                          type="button"
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
                                type="button"
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
                              type="button"
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
                          rows={2}
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
                          className="w-full resize-none rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 py-3 font-mono text-xs leading-5 text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
                        />
                      </label>
                    </div>
                  </section>
                </>
              )}
            </div>

            {/* 右侧面板：实时预览与压力靶场 */}
            <aside className="lg:sticky lg:top-24 lg:self-start space-y-4">
              <div className="overflow-hidden rounded-[32px] border border-black/[0.06] bg-white shadow-xl">
                <div className="h-2" style={{ backgroundColor: categoryColor }} />

                {/* 右侧顶部 Tab 切换：预览 vs 靶场 */}
                <div className="flex border-b border-black/[0.05] p-2 bg-slate-50/60">
                  <button
                    type="button"
                    onClick={() => setRightPanelTab('preview')}
                    className={cn(
                      'flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl py-2 text-xs font-bold transition',
                      rightPanelTab === 'preview' ? 'bg-white text-slate-950 shadow-2xs' : 'text-slate-500 hover:text-slate-800'
                    )}
                  >
                    <Eye size={14} />
                    实时卡片预览
                  </button>
                  <button
                    type="button"
                    onClick={() => setRightPanelTab('arena')}
                    className={cn(
                      'flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl py-2 text-xs font-bold transition',
                      rightPanelTab === 'arena' ? 'bg-amber-500 text-white shadow-2xs' : 'text-slate-500 hover:text-slate-800'
                    )}
                  >
                    <Flame size={14} />
                    🔥 压力测试靶场
                    {stressTestCases.length > 0 && <span className="h-2 w-2 rounded-full bg-white animate-pulse" />}
                  </button>
                </div>

                <div className="p-5">
                  {/* Tab 1: 静态卡片预览 */}
                  {rightPanelTab === 'preview' ? (
                    <div>
                      <div className="mb-4 flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-400">公开状态</span>
                        <button
                          onClick={() => setIsPublic(!isPublic)}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition',
                            isPublic ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'
                          )}
                        >
                          {isPublic ? <Check size={14} /> : <Lock size={14} />}
                          {isPublic ? '公开' : '私有'}
                        </button>
                      </div>

                      <div className="rounded-[24px] bg-[#fbfaf7] p-5">
                        <div className="mb-4 flex items-start gap-4">
                          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-3xl shadow-2xs">
                            {selectedAvatar}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="truncate text-lg font-black text-slate-950">{name || '未命名 Agent'}</h3>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <span
                                className="rounded-full px-2.5 py-0.5 text-2xs font-bold text-white"
                                style={{ backgroundColor: categoryColor }}
                              >
                                {category}
                              </span>
                              <span className="rounded-full bg-white px-2 py-0.5 text-2xs font-bold text-slate-600">
                                {tone}
                              </span>
                            </div>
                          </div>
                        </div>

                        <p className="min-h-[40px] text-xs leading-5 text-slate-600">
                          {description || '写一句话，让用户知道这个 Agent 最擅长什么。'}
                        </p>

                        <div className="mt-4 rounded-xl bg-white p-3 border border-black/[0.04]">
                          <div className="mb-1 text-2xs font-bold text-slate-400">开场白</div>
                          <p className="text-xs leading-5 text-slate-700">“{finalGreeting}”</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Tab 2: 压力测试靶场（Stress Test Arena） */
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-xs font-black text-slate-900">
                          <Flame size={14} className="text-amber-500" />
                          <span>在线压力测试靶场</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setArenaMessages([{ role: 'assistant', content: finalGreeting }])}
                          className="inline-flex items-center gap-1 text-2xs text-slate-400 hover:text-slate-600"
                        >
                          <RotateCcw size={12} />
                          清空演练
                        </button>
                      </div>

                      {/* 3 道一键测试题 */}
                      {stressTestCases.length > 0 ? (
                        <div className="space-y-1.5">
                          <span className="block text-2xs font-bold text-slate-400">点击发起刁难测试题：</span>
                          {stressTestCases.map((tc, idx) => (
                            <button
                              key={idx}
                              type="button"
                              disabled={arenaStreaming}
                              onClick={() => handleSendArenaMessage(tc)}
                              className="w-full rounded-xl border border-amber-200/80 bg-amber-50/50 p-2 text-left text-xs font-medium text-amber-900 transition hover:bg-amber-100/70 disabled:opacity-50"
                            >
                              <span className="font-bold text-amber-700 mr-1">考题 {idx + 1}:</span> {tc}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-xl bg-slate-50 p-3 text-center text-xs text-slate-500">
                          在左侧完成“编译专业数字员工”后，系统将自动生成 3 道刁钻考题。
                        </div>
                      )}

                      {/* 靶场聊天对话流 */}
                      <div className="h-64 overflow-y-auto rounded-2xl bg-slate-50 p-3 space-y-2 border border-slate-100">
                        {arenaMessages.map((m, idx) => (
                          <div
                            key={idx}
                            className={cn('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}
                          >
                            <span className="text-2xs text-slate-400 mb-0.5">{m.role === 'user' ? '你 (测试者)' : name || 'Agent'}</span>
                            <div
                              className={cn(
                                'max-w-[90%] rounded-2xl px-3 py-2 text-xs leading-5 whitespace-pre-wrap',
                                m.role === 'user'
                                  ? 'bg-slate-950 text-white rounded-br-xs'
                                  : 'bg-white text-slate-800 shadow-2xs border border-slate-200/60 rounded-bl-xs'
                              )}
                            >
                              {m.content || (arenaStreaming && idx === arenaMessages.length - 1 ? '思考反驳中...' : '')}
                            </div>
                          </div>
                        ))}
                      </div>

                      {/* 靶场输入框 */}
                      <div className="flex gap-2">
                        <input
                          value={arenaInput}
                          onChange={(e) => setArenaInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSendArenaMessage();
                          }}
                          placeholder="输入刁难指令测试底线..."
                          className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-400"
                        />
                        <button
                          type="button"
                          disabled={arenaStreaming || !arenaInput.trim()}
                          onClick={() => handleSendArenaMessage()}
                          className="rounded-xl bg-slate-950 px-3 py-2 text-white transition hover:bg-slate-800 disabled:opacity-40"
                        >
                          <Send size={14} />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 保存按钮 */}
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
                    {submitting ? '保存中...' : editingAgentId ? '保存修改' : '创建并开始工作'}
                  </button>
                </div>
              </div>
            </aside>
          </div>
        ) : (
          <KnowledgeManager agentId={editingAgentId} agentName={name} />
        )}
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
