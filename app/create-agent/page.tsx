'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  Loader2,
  Lock,
  MapPin,
  Palette,
  RefreshCw,
  Scroll,
  Search,
  Sparkles,
  Wand2,
} from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import LoginRequired from '@/components/auth/LoginRequired';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { cn } from '@/lib/utils';
import { CATEGORIES, TONES, CATEGORY_COLORS } from '@/types';
import { agents, auth } from '@/lib/api';

const AVATAR_OPTIONS = ['🎭', '🏰', '🔍', '💜', '⚔️', '🌟', '👻', '🎪', '🧩', '🗡️', '📖', '🌙', '🔮', '🎯', '🏴‍☠️', '🦋'];

type CreationType = 'mystery' | 'world' | 'character' | 'script';

interface CreationTypeOption {
  id: CreationType;
  name: string;
  icon: string;
  description: string;
  color: string;
}

const CREATION_TYPES: CreationTypeOption[] = [
  {
    id: 'mystery',
    name: '谜案推理',
    icon: '🔍',
    description: '创建一个结构化的推理案件，包含嫌疑人、线索、真相和多个结局。',
    color: '#6366f1',
  },
  {
    id: 'world',
    name: '故事世界',
    icon: '🏰',
    description: '创建一个广阔的可探索世界，包含地点、角色、规则和目标。',
    color: '#06b6d4',
  },
  {
    id: 'character',
    name: '角色扮演',
    icon: '🎭',
    description: '创建一个独特的角色或 NPC，包含性格、说话风格和背景故事。',
    color: '#8b5cf6',
  },
  {
    id: 'script',
    name: '互动剧本',
    icon: '📖',
    description: '创建一个分支故事，包含选择、触发事件和多个结局。',
    color: '#f59e0b',
  },
];

interface AccordionSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  color: string;
}

const MYSTERY_SECTIONS: AccordionSection[] = [
  { id: 'concept', title: '案件概念与嫌疑人', icon: <Search size={18} />, color: '#6366f1' },
  { id: 'clues', title: '线索与干扰项', icon: <BookOpen size={18} />, color: '#8b5cf6' },
  { id: 'truth', title: '真相与结局', icon: <MapPin size={18} />, color: '#f43f5e' },
  { id: 'opening', title: '场景与开场', icon: <Scroll size={18} />, color: '#10b981' },
];

function AccordionPanel({
  section,
  isOpen,
  onToggle,
  generating,
  onGenerate,
  children,
}: {
  section: AccordionSection;
  isOpen: boolean;
  onToggle: () => void;
  generating: boolean;
  onGenerate: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[#242039]">
      <div className="flex w-full items-center justify-between p-5 text-left sm:p-6">
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-2xl"
            style={{ backgroundColor: `${section.color}20`, color: section.color }}
          >
            {section.icon}
          </div>
          <div>
            <h2 className="text-lg font-black text-white">{section.title}</h2>
          </div>
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onGenerate();
            }}
            disabled={generating}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition',
              generating
                ? 'bg-white/[0.08] text-white/30'
                : 'bg-white/[0.08] text-white/64 hover:bg-white/[0.12]'
            )}
          >
            {generating ? (
              <>
                <LoadingSpinner size="sm" />
                生成中
              </>
            ) : (
              <>
                <Sparkles size={12} />
                AI 建议
              </>
            )}
          </button>
          <ChevronDown
            size={20}
            className={cn(
              'text-white/40 transition-transform',
              isOpen && 'rotate-180'
            )}
          />
        </div>
      </div>
      {isOpen && <div className="px-5 pb-5 sm:px-6 sm:pb-6">{children}</div>}
    </section>
  );
}

function CreateAgentContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editingAgentId = searchParams.get('agentId');

  // Core state
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('悬疑推理');
  const [tone, setTone] = useState('悬疑');
  const [greeting, setGreeting] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('🎭');
  const [isPublic, setIsPublic] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [needsLogin, setNeedsLogin] = useState<boolean | null>(null);
  const [loadingAgent, setLoadingAgent] = useState(false);

  // Creation flow state
  const [creationType, setCreationType] = useState<CreationType | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['concept']));
  const [generatingSection, setGeneratingSection] = useState<string | null>(null);

  // Mystery Case fields (manual or AI-assisted)
  const [concept, setConcept] = useState('');
  const [suspects, setSuspects] = useState<any[]>([]);
  const [coreTrick, setCoreTrick] = useState('');
  const [clues, setClues] = useState<any[]>([]);
  const [redHerrings, setRedHerrings] = useState<any[]>([]);
  const [truth, setTruth] = useState<any>(null);
  const [solutionCondition, setSolutionCondition] = useState('');
  const [endings, setEndings] = useState<any[]>([]);
  const [openingScene, setOpeningScene] = useState('');
  const [crimeScene, setCrimeScene] = useState('');
  const [generatedGreeting, setGeneratedGreeting] = useState('');
  const [generatedSystemPrompt, setGeneratedSystemPrompt] = useState('');

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
          setCategory(agent.category || '悬疑推理');
          setTone(agent.tone || '悬疑');
          setGreeting(agent.greeting || '');
          setSystemPrompt(agent.systemPrompt || '');
          setSelectedAvatar(agent.avatar || '🎭');
          setIsPublic(Boolean(agent.isPublic));

          if (agent.creationType) {
            setCreationType(agent.creationType as CreationType);
          }
          if (agent.builderConfig) {
            try {
              const config = JSON.parse(agent.builderConfig);
              setConcept(config.concept || '');
              setSuspects(config.suspects || []);
              setCoreTrick(config.coreTrick || '');
              setClues(config.clues || []);
              setRedHerrings(config.redHerrings || []);
              setTruth(config.truth || null);
              setSolutionCondition(config.solutionCondition || '');
              setEndings(config.endings || []);
              setOpeningScene(config.openingScene || '');
              setCrimeScene(config.crimeScene || '');
              setGeneratedGreeting(config.greeting || '');
              setGeneratedSystemPrompt(config.systemPrompt || '');
            } catch {}
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

  const finalGreeting = useMemo(() => {
    if (greeting.trim()) return greeting;
    if (generatedGreeting) return generatedGreeting;
    if (!name.trim()) return '欢迎来到这个世界。你的冒险从这里开始。';
    return `欢迎来到${name}。你的冒险从这里开始。`;
  }, [greeting, generatedGreeting, name]);

  const finalPrompt = useMemo(() => {
    if (systemPrompt.trim()) return systemPrompt;
    if (generatedSystemPrompt) return generatedSystemPrompt;
    return `你是一个${category}类型的故事世界。氛围风格是${tone}。你需要引导玩家进入故事，做出选择，推动剧情发展。`;
  }, [category, systemPrompt, tone, generatedSystemPrompt]);

  const toggleSection = (sectionId: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  // AI Generate for a specific section
  const handleGenerate = async (sectionId: string) => {
    if (generatingSection) return;
    setGeneratingSection(sectionId);

    try {
      let step = 1;
      let confirmedData: Record<string, any> = {};

      if (sectionId === 'concept') {
        step = 1;
        confirmedData = { concept };
      } else if (sectionId === 'clues') {
        step = 2;
        confirmedData = { suspects, coreTrick, concept };
      } else if (sectionId === 'truth') {
        step = 3;
        confirmedData = { suspects, clues, concept };
      } else if (sectionId === 'opening') {
        step = 4;
        confirmedData = { suspects, clues, truth, endings, solutionCondition, concept };
      }

      const response = await fetch('/api/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          creationType,
          step,
          concept,
          confirmedData,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Generation failed');
      }

      const result = await response.json();
      const data = result.data;

      // Apply generated data to fields
      if (sectionId === 'concept') {
        if (data.suspects) setSuspects(data.suspects);
        if (data.coreTrick) setCoreTrick(data.coreTrick);
        if (!name) setName('未命名谜案');
        if (!description && data.coreTrick) setDescription(data.coreTrick.slice(0, 100));
      } else if (sectionId === 'clues') {
        if (data.clues) setClues(data.clues);
        if (data.redHerrings) setRedHerrings(data.redHerrings);
      } else if (sectionId === 'truth') {
        if (data.truth) setTruth(data.truth);
        if (data.solutionCondition) setSolutionCondition(data.solutionCondition);
        if (data.endings) setEndings(data.endings);
      } else if (sectionId === 'opening') {
        if (data.openingScene) setOpeningScene(data.openingScene);
        if (data.crimeScene) setCrimeScene(data.crimeScene);
        if (data.greeting) setGeneratedGreeting(data.greeting);
        if (data.systemPrompt) setGeneratedSystemPrompt(data.systemPrompt);
      }
    } catch (error: any) {
      console.error('Generation error:', error);
      alert(error.message || '生成失败，请重试');
    } finally {
      setGeneratingSection(null);
    }
  };

  // Submit the agent
  const handleSubmit = async () => {
    if (!canCreate || submitting) return;

    setSubmitting(true);
    try {
      const builderConfig = creationType === 'mystery' ? {
        type: 'mystery',
        concept,
        suspects,
        coreTrick,
        clues,
        redHerrings,
        truth,
        solutionCondition,
        endings,
        openingScene,
        crimeScene,
        greeting: generatedGreeting,
        systemPrompt: generatedSystemPrompt,
      } : undefined;

      const payload = {
        name,
        description,
        category,
        tone,
        greeting: finalGreeting,
        systemPrompt: finalPrompt,
        avatar: selectedAvatar,
        isPublic,
        creationType,
        builderConfig,
        hook: description,
        openingScene: openingScene || undefined,
        playerRole: undefined,
        rules: undefined,
        winConditions: solutionCondition || undefined,
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
          <Loader2 className="animate-spin text-white/40" size={24} />
        </div>
      </AppShell>
    );
  }

  if (needsLogin) {
    return (
      <AppShell>
        <div className="py-8">
          <LoginRequired
            title="登录后创作你的世界"
            description="创作世界会保存头像、设定、开场白和发布状态。登录后可以在我的空间继续维护。"
          />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="py-8">
        {/* Header */}
        <section className="mb-8 rounded-[32px] border border-white/10 bg-[#19172a] p-6 backdrop-blur sm:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-4 py-2 text-sm font-bold text-white/82 backdrop-blur">
                <Wand2 size={16} className="text-[#d89022]" />
                {editingAgentId ? '体验编辑器' : '体验创作器'}
              </div>
              <h1 className="text-4xl font-black leading-tight text-white sm:text-5xl">
                {editingAgentId ? '继续打磨你的体验。' : '创造一个可玩的故事体验。'}
              </h1>
              <p className="mt-4 text-base leading-7 text-white/58">
                {editingAgentId
                  ? '修改设定、内容和开场白。保存后会更新你的体验。'
                  : '选择类型，填写内容。每个部分都可以手动填写或让 AI 提供建议。'}
              </p>
            </div>
            {creationType && (
              <button
                onClick={() => setCreationType(null)}
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-4 py-2 text-sm font-bold text-white/70 transition hover:bg-white/[0.12]"
              >
                <RefreshCw size={14} />
                重新选择类型
              </button>
            )}
          </div>
        </section>

        {/* Type Selection */}
        {!creationType && (
          <section className="mb-8">
            <h2 className="mb-6 text-2xl font-black text-white">选择创作类型</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {CREATION_TYPES.map((type) => (
                <button
                  key={type.id}
                  onClick={() => {
                    setCreationType(type.id);
                    if (type.id === 'mystery') setCategory('悬疑推理');
                    else if (type.id === 'world') setCategory('奇幻冒险');
                    else if (type.id === 'character') setCategory('角色扮演');
                    else if (type.id === 'script') setCategory('浪漫言情');
                  }}
                  className="group rounded-[28px] border border-white/10 bg-[#242039] p-6 text-left transition hover:-translate-y-1 hover:border-white/20 hover:shadow-xl"
                >
                  <div
                    className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-3xl"
                    style={{ backgroundColor: `${type.color}20` }}
                  >
                    {type.icon}
                  </div>
                  <h3 className="mb-2 text-lg font-black text-white">{type.name}</h3>
                  <p className="text-sm leading-6 text-white/54">{type.description}</p>
                  <div className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-white/40 transition group-hover:text-white/70">
                    开始创作
                    <ChevronRight size={14} />
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Mystery Case Builder - All sections on one page */}
        {creationType === 'mystery' && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-4">
              {/* Section 1: Concept & Suspects */}
              <AccordionPanel
                section={MYSTERY_SECTIONS[0]}
                isOpen={openSections.has('concept')}
                onToggle={() => toggleSection('concept')}
                generating={generatingSection === 'concept'}
                onGenerate={() => handleGenerate('concept')}
              >
                <div className="space-y-4">
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-white/70">案件概念</span>
                    <textarea
                      value={concept}
                      onChange={(e) => setConcept(e.target.value)}
                      placeholder="例如：密室谋杀案，所有人都是朋友。每个人都有秘密，每个人都可能是凶手。"
                      rows={3}
                      className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm font-medium leading-6 text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                    />
                  </label>

                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-bold text-white/70">嫌疑人</span>
                      <button
                        onClick={() => setSuspects([...suspects, { name: '', role: '', motive: '', secret: '' }])}
                        className="text-xs font-bold text-white/40 hover:text-white/64"
                      >
                        + 添加嫌疑人
                      </button>
                    </div>
                    {suspects.map((suspect, index) => (
                      <div key={index} className="mb-3 rounded-2xl bg-white/[0.06] p-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <input
                            value={suspect.name}
                            onChange={(e) => {
                              const updated = [...suspects];
                              updated[index].name = e.target.value;
                              setSuspects(updated);
                            }}
                            placeholder="姓名"
                            className="h-10 rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                          />
                          <input
                            value={suspect.role}
                            onChange={(e) => {
                              const updated = [...suspects];
                              updated[index].role = e.target.value;
                              setSuspects(updated);
                            }}
                            placeholder="身份"
                            className="h-10 rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                          />
                        </div>
                        <input
                          value={suspect.motive}
                          onChange={(e) => {
                            const updated = [...suspects];
                            updated[index].motive = e.target.value;
                            setSuspects(updated);
                          }}
                          placeholder="动机"
                          className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                        />
                        <input
                          value={suspect.secret}
                          onChange={(e) => {
                            const updated = [...suspects];
                            updated[index].secret = e.target.value;
                            setSuspects(updated);
                          }}
                          placeholder="秘密"
                          className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                        />
                        <button
                          onClick={() => setSuspects(suspects.filter((_, i) => i !== index))}
                          className="mt-2 text-xs text-rose-400 hover:text-rose-300"
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-white/70">核心诡计</span>
                    <textarea
                      value={coreTrick}
                      onChange={(e) => setCoreTrick(e.target.value)}
                      placeholder="案件的核心手法或谜题"
                      rows={2}
                      className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm font-medium leading-6 text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                    />
                  </label>
                </div>
              </AccordionPanel>

              {/* Section 2: Clues */}
              <AccordionPanel
                section={MYSTERY_SECTIONS[1]}
                isOpen={openSections.has('clues')}
                onToggle={() => toggleSection('clues')}
                generating={generatingSection === 'clues'}
                onGenerate={() => handleGenerate('clues')}
              >
                <div className="space-y-4">
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-bold text-white/70">线索</span>
                      <button
                        onClick={() => setClues([...clues, { name: '', description: '', visibility: 'public' }])}
                        className="text-xs font-bold text-white/40 hover:text-white/64"
                      >
                        + 添加线索
                      </button>
                    </div>
                    {clues.map((clue, index) => (
                      <div key={index} className="mb-3 rounded-2xl bg-white/[0.06] p-4">
                        <div className="flex items-center gap-3">
                          <input
                            value={clue.name}
                            onChange={(e) => {
                              const updated = [...clues];
                              updated[index].name = e.target.value;
                              setClues(updated);
                            }}
                            placeholder="线索名称"
                            className="h-10 flex-1 rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                          />
                          <select
                            value={clue.visibility}
                            onChange={(e) => {
                              const updated = [...clues];
                              updated[index].visibility = e.target.value;
                              setClues(updated);
                            }}
                            className="h-10 rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none"
                          >
                            <option value="public">公开</option>
                            <option value="hidden">隐藏</option>
                          </select>
                        </div>
                        <textarea
                          value={clue.description}
                          onChange={(e) => {
                            const updated = [...clues];
                            updated[index].description = e.target.value;
                            setClues(updated);
                          }}
                          placeholder="线索描述"
                          rows={2}
                          className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
                        />
                        <button
                          onClick={() => setClues(clues.filter((_, i) => i !== index))}
                          className="mt-2 text-xs text-rose-400 hover:text-rose-300"
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>

                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-bold text-white/70">干扰项</span>
                      <button
                        onClick={() => setRedHerrings([...redHerrings, { name: '', description: '' }])}
                        className="text-xs font-bold text-white/40 hover:text-white/64"
                      >
                        + 添加干扰项
                      </button>
                    </div>
                    {redHerrings.map((item, index) => (
                      <div key={index} className="mb-3 rounded-2xl bg-rose-500/10 p-4">
                        <input
                          value={item.name}
                          onChange={(e) => {
                            const updated = [...redHerrings];
                            updated[index].name = e.target.value;
                            setRedHerrings(updated);
                          }}
                          placeholder="干扰项名称"
                          className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                        />
                        <textarea
                          value={item.description}
                          onChange={(e) => {
                            const updated = [...redHerrings];
                            updated[index].description = e.target.value;
                            setRedHerrings(updated);
                          }}
                          placeholder="描述"
                          rows={2}
                          className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
                        />
                        <button
                          onClick={() => setRedHerrings(redHerrings.filter((_, i) => i !== index))}
                          className="mt-2 text-xs text-rose-400 hover:text-rose-300"
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </AccordionPanel>

              {/* Section 3: Truth & Endings */}
              <AccordionPanel
                section={MYSTERY_SECTIONS[2]}
                isOpen={openSections.has('truth')}
                onToggle={() => toggleSection('truth')}
                generating={generatingSection === 'truth'}
                onGenerate={() => handleGenerate('truth')}
              >
                <div className="space-y-4">
                  <div className="rounded-2xl bg-white/[0.06] p-4">
                    <span className="text-sm font-bold text-white/70">真相</span>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <input
                        value={truth?.killer || ''}
                        onChange={(e) => setTruth({ ...truth, killer: e.target.value })}
                        placeholder="凶手"
                        className="h-10 rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                      />
                      <input
                        value={truth?.method || ''}
                        onChange={(e) => setTruth({ ...truth, method: e.target.value })}
                        placeholder="作案手法"
                        className="h-10 rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                      />
                    </div>
                    <textarea
                      value={truth?.narrative || ''}
                      onChange={(e) => setTruth({ ...truth, narrative: e.target.value })}
                      placeholder="真相叙述"
                      rows={3}
                      className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
                    />
                  </div>

                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-white/70">破案条件</span>
                    <textarea
                      value={solutionCondition}
                      onChange={(e) => setSolutionCondition(e.target.value)}
                      placeholder="玩家需要满足什么条件才能破案"
                      rows={2}
                      className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm font-medium leading-6 text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                    />
                  </label>

                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-bold text-white/70">结局</span>
                      <button
                        onClick={() => setEndings([...endings, { id: `ending_${endings.length}`, name: '', condition: '', description: '' }])}
                        className="text-xs font-bold text-white/40 hover:text-white/64"
                      >
                        + 添加结局
                      </button>
                    </div>
                    {endings.map((ending, index) => (
                      <div key={index} className="mb-3 rounded-2xl bg-white/[0.06] p-4">
                        <input
                          value={ending.name}
                          onChange={(e) => {
                            const updated = [...endings];
                            updated[index].name = e.target.value;
                            setEndings(updated);
                          }}
                          placeholder="结局名称"
                          className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                        />
                        <input
                          value={ending.condition}
                          onChange={(e) => {
                            const updated = [...endings];
                            updated[index].condition = e.target.value;
                            setEndings(updated);
                          }}
                          placeholder="触发条件"
                          className="mt-2 h-10 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                        />
                        <textarea
                          value={ending.description}
                          onChange={(e) => {
                            const updated = [...endings];
                            updated[index].description = e.target.value;
                            setEndings(updated);
                          }}
                          placeholder="结局描述"
                          rows={2}
                          className="mt-2 w-full resize-none rounded-xl border border-white/10 bg-white/[0.08] px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
                        />
                        <button
                          onClick={() => setEndings(endings.filter((_, i) => i !== index))}
                          className="mt-2 text-xs text-rose-400 hover:text-rose-300"
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </AccordionPanel>

              {/* Section 4: Opening Scene */}
              <AccordionPanel
                section={MYSTERY_SECTIONS[3]}
                isOpen={openSections.has('opening')}
                onToggle={() => toggleSection('opening')}
                generating={generatingSection === 'opening'}
                onGenerate={() => handleGenerate('opening')}
              >
                <div className="space-y-4">
                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-white/70">开场场景</span>
                    <textarea
                      value={openingScene}
                      onChange={(e) => setOpeningScene(e.target.value)}
                      placeholder="描述玩家进入故事时看到的场景"
                      rows={4}
                      className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm font-medium leading-6 text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-white/70">案发现场</span>
                    <textarea
                      value={crimeScene}
                      onChange={(e) => setCrimeScene(e.target.value)}
                      placeholder="描述案件发生的具体地点"
                      rows={3}
                      className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm font-medium leading-6 text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-white/70">欢迎消息</span>
                    <textarea
                      value={generatedGreeting}
                      onChange={(e) => setGeneratedGreeting(e.target.value)}
                      placeholder="玩家看到的第一条消息"
                      rows={2}
                      className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 text-sm font-medium leading-6 text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-bold text-white/70">系统提示词</span>
                    <textarea
                      value={generatedSystemPrompt}
                      onChange={(e) => setGeneratedSystemPrompt(e.target.value)}
                      placeholder="运行时使用的系统提示词"
                      rows={6}
                      className="w-full resize-none rounded-2xl border border-white/10 bg-white/[0.08] px-4 py-3 font-mono text-sm leading-6 text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/[0.06]"
                    />
                  </label>
                </div>
              </AccordionPanel>
            </div>

            {/* Preview Panel */}
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="overflow-hidden rounded-[32px] border border-white/10 bg-[#242039]">
                <div className="h-2 bg-[#6366f1]" />
                <div className="p-6">
                  <div className="mb-5 flex items-center justify-between">
                    <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-bold text-white/64">
                      <Eye size={14} />
                      实时预览
                    </div>
                    <button
                      onClick={() => setIsPublic(!isPublic)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition',
                        isPublic ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/[0.08] text-white/64'
                      )}
                    >
                      {isPublic ? <Check size={14} /> : <Lock size={14} />}
                      {isPublic ? '公开' : '私有'}
                    </button>
                  </div>

                  <div className="rounded-[28px] bg-white/[0.06] p-5">
                    <div className="mb-5 flex items-start gap-4">
                      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white/[0.08] text-4xl">
                        {selectedAvatar}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-xl font-black text-white">{name || '未命名体验'}</h3>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className="rounded-full px-2.5 py-1 text-xs font-bold text-white" style={{ backgroundColor: categoryColor }}>
                            {category}
                          </span>
                          <span className="rounded-full bg-white/[0.08] px-2.5 py-1 text-xs font-bold text-white/64">
                            {tone}
                          </span>
                        </div>
                      </div>
                    </div>

                    <p className="min-h-[48px] text-sm leading-6 text-white/64">
                      {description || '写一句话，吸引玩家进入这个体验。'}
                    </p>

                    {suspects.length > 0 && (
                      <div className="mt-4 rounded-2xl bg-white/[0.08] p-4">
                        <div className="mb-2 text-xs font-bold text-white/40">嫌疑人 ({suspects.length})</div>
                        <div className="flex flex-wrap gap-1">
                          {suspects.map((s, i) => (
                            <span key={i} className="rounded-full bg-white/[0.08] px-2 py-0.5 text-xs text-white/64">
                              {s.name || '未命名'}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {clues.length > 0 && (
                      <div className="mt-3 rounded-2xl bg-white/[0.08] p-4">
                        <div className="mb-1 text-xs font-bold text-white/40">线索 ({clues.length})</div>
                      </div>
                    )}

                    {truth?.killer && (
                      <div className="mt-3 rounded-2xl bg-white/[0.08] p-4">
                        <div className="mb-1 text-xs font-bold text-white/40">凶手</div>
                        <p className="text-sm text-white/70">{truth.killer}</p>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-bold text-white/70">名称</span>
                      <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="体验名称"
                        className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-2 block text-sm font-bold text-white/70">简介</span>
                      <input
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="一句话简介"
                        className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.08] px-3 text-sm text-white outline-none placeholder:text-white/40"
                      />
                    </label>
                  </div>

                  <button
                    onClick={handleSubmit}
                    disabled={!canCreate || submitting}
                    className={cn(
                      'mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-black transition',
                      canCreate && !submitting
                        ? 'bg-white text-[#19172a] shadow-sm hover:-translate-y-0.5 hover:shadow-lg'
                        : 'bg-white/[0.08] text-white/30'
                    )}
                  >
                    <Sparkles size={16} />
                    {submitting ? '保存中...' : editingAgentId ? '保存修改' : '创建体验'}
                  </button>
                </div>
              </div>
            </aside>
          </div>
        )}

        {/* Other creation types placeholder */}
        {creationType && creationType !== 'mystery' && (
          <div className="rounded-[32px] border border-dashed border-white/18 bg-white/[0.04] p-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-white/[0.08] text-3xl">
              {CREATION_TYPES.find((t) => t.id === creationType)?.icon}
            </div>
            <h3 className="mb-2 text-xl font-black text-white">
              {CREATION_TYPES.find((t) => t.id === creationType)?.name} 创作器
            </h3>
            <p className="mb-6 text-sm text-white/54">
              此类型的创作器正在开发中。你可以使用基础字段手动创建。
            </p>
            <button
              onClick={() => setCreationType(null)}
              className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-[#19172a] transition hover:-translate-y-0.5 hover:shadow-lg"
            >
              返回选择
            </button>
          </div>
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
            <Loader2 className="animate-spin text-white/40" size={24} />
          </div>
        </AppShell>
      }
    >
      <CreateAgentContent />
    </Suspense>
  );
}
