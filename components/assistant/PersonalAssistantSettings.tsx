'use client';

import { useEffect, useRef, useState } from 'react';
import { Brain, Heart, Loader2, MessageCircleHeart, Plus, RotateCcw, Save, Sparkles, Trash2, Upload } from 'lucide-react';
import Avatar from '@/components/shared/Avatar';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { assistant, uploads } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AssistantMemoryItem, PersonalAssistantProfile } from '@/types';

const EMPTY_PROFILE: PersonalAssistantProfile = { name: '', avatar: '', identity: '', soul: '', greeting: '' };

const COMPANION_EMBLEMS = ['🌿', '☕', '✨', '💬', '🌙', '🌟', '🕊️', '🧸'];

interface CompanionPreset {
  id: string;
  name: string;
  tag: string;
  desc: string;
  avatar: string;
  identity: string;
  soul: string;
  greeting: string;
}

const COMPANION_PRESETS: CompanionPreset[] = [
  {
    id: 'warm-companion',
    name: '默契好友 · 温暖常在',
    tag: '真诚倾听 · 情绪陪伴',
    desc: '像懂你的老友，随时倾听心声、分享日常琐碎，给予安定温暖的情绪支持',
    avatar: '🌿',
    identity:
      '我是你的贴心日常搭子与默契好友「小伴」。我了解你的生活习惯、作息节奏与个人喜好，一直默默陪伴在你的身边，随时准备听你倾诉、陪你聊天。',
    soul:
      '温和有耐心，懂得共情；语气自然亲切，不带任何机械距离感；在你疲惫压力大时给予暖心关怀，在你开心时与你一同分享；少说教，多倾听。',
    greeting: '我在呢。今天心情怎么样？随时可以和我聊聊。',
  },
  {
    id: 'thoughtful-guide',
    name: '懂你智囊 · 梳理思路',
    tag: '耐心梳理 · 贴心启发',
    desc: '温和而有条理，帮你化解焦虑，把杂乱的想法与日常待办慢慢理顺',
    avatar: '☕',
    identity:
      '我是你的贴身思考智囊与思路梳理伙伴。熟悉你的工作习惯与思考方式，协助你在纷杂的信息和思绪中理清脉络，找到清晰安定的方向。',
    soul:
      '理性而温和，善于启发与提问；不急于评判或灌输大道理，而是像朋友一样陪你一步步推演想法；表达舒缓有条理，给出贴心实用的建议。',
    greeting: '今天脑海里有什么想理一理的想法吗？不用急，我们慢慢聊。',
  },
  {
    id: 'cheerleader-friend',
    name: '积极同行 · 成长打气',
    tag: '阳光鼓励 · 共同前进',
    desc: '给你持续的正向反馈，陪伴你克服拖延、推进目标，见证每个微小成长',
    avatar: '🌟',
    identity:
      '我是你的积极成长伙伴与支持者。陪伴你保持专注、达成日常目标，做你坚定的打气筒与成长见证者。',
    soul:
      '真诚温暖、阳光向上；善于发现你的闪光点与小突破；用温柔坚定的力量陪你战胜拖延，给予你源源不断的情绪力量与前行动力。',
    greeting: '嗨！今天又是新的一天，有什么想一起完成的小目标或者想分享的进展吗？',
  },
];

export default function PersonalAssistantSettings() {
  const [profile, setProfile] = useState<PersonalAssistantProfile>(EMPTY_PROFILE);
  const [memories, setMemories] = useState<AssistantMemoryItem[]>([]);
  const [newMemory, setNewMemory] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [memoryBusyId, setMemoryBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    description: React.ReactNode;
    icon?: React.ReactNode;
    confirmText?: string;
    destructive?: boolean;
    onConfirm: () => Promise<void> | void;
  } | null>(null);
  const [modalLoading, setModalLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    assistant.get()
      .then((result) => {
        setProfile(result.profile);
        setMemories(result.memories);
      })
      .catch((reason: any) => setError(reason.message || '加载助理设置失败'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const onProactiveChanged = (event: Event) => {
      const customEvent = event as CustomEvent<{ enabled: boolean }>;
      if (typeof customEvent.detail?.enabled === 'boolean') {
        setProfile((prev) => ({ ...prev, proactiveEnabled: customEvent.detail.enabled }));
      }
    };
    window.addEventListener('personal-assistant-proactive-changed', onProactiveChanged);
    return () => window.removeEventListener('personal-assistant-proactive-changed', onProactiveChanged);
  }, []);

  const handleToggleProactive = async () => {
    const active = profile.proactiveEnabled !== false && (profile.proactiveEnabled as any) !== 0 && (profile.proactiveEnabled as any) !== '0';
    const nextVal = !active;
    setProfile((p) => ({ ...p, proactiveEnabled: nextVal }));
    if (typeof window !== 'undefined') {
      localStorage.setItem('almaren_assistant_proactive_enabled', String(nextVal));
      window.dispatchEvent(new CustomEvent('personal-assistant-proactive-changed', { detail: { enabled: nextVal } }));
    }
    try {
      await assistant.updateProfile({ proactiveEnabled: nextVal });
    } catch {
      // Keep optimistic local state
    }
  };

  const changeProfile = (field: keyof PersonalAssistantProfile, value: string) => {
    setProfile((current) => ({ ...current, [field]: value }));
    setNotice('');
  };

  const notifyAssistant = () => window.dispatchEvent(new Event('personal-assistant-updated'));

  const applyPreset = (preset: CompanionPreset) => {
    setProfile((current) => ({
      ...current,
      avatar: preset.avatar,
      identity: preset.identity,
      soul: preset.soul,
      greeting: preset.greeting,
    }));
    setNotice(`已载入「${preset.name}」陪伴风格，点击保存即可生效`);
  };

  const handleUploadAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    setError('');
    try {
      const res = await uploads.image(file);
      changeProfile('avatar', res.attachment.url);
      setNotice('专属头像已上传');
    } catch (err: any) {
      setError(err.message || '上传头像失败');
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const saveProfile = async () => {
    if (!profile.name.trim() || saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await assistant.updateProfile(profile);
      setProfile(result.profile);
      if (typeof window !== 'undefined') {
        localStorage.setItem('almaren_assistant_proactive_enabled', String(result.profile.proactiveEnabled !== false));
      }
      setNotice('助理设置已成功保存');
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

  const requestDeleteMemory = (item: AssistantMemoryItem) => {
    setConfirmModal({
      title: '删除这条记忆？',
      description: (
        <>
          确定要让小伴忘记这件小事吗？
          <div className="mt-2.5 rounded-xl border border-black/[0.06] bg-[#fbfaf7] p-3 text-xs font-semibold leading-5 text-slate-800">
            {item.content}
          </div>
        </>
      ),
      icon: <Trash2 size={20} />,
      confirmText: '确认删除',
      destructive: true,
      onConfirm: async () => {
        setModalLoading(true);
        setError('');
        try {
          await assistant.deleteMemory(item.id);
          setMemories((items) => items.filter((m) => m.id !== item.id));
          notifyAssistant();
        } catch (reason: any) {
          setError(reason.message || '删除记忆失败');
        } finally {
          setModalLoading(false);
          setConfirmModal(null);
        }
      },
    });
  };

  const clearAllMemories = () => {
    if (memories.length === 0) return;
    setConfirmModal({
      title: '清空全部长期记忆？',
      description: '确定清空所有长期记忆吗？此操作将彻底删除小伴记住的所有偏好与事实，且无法撤销。',
      icon: <Trash2 size={20} />,
      confirmText: '确认清空',
      destructive: true,
      onConfirm: async () => {
        setModalLoading(true);
        setError('');
        try {
          await assistant.clearAllMemories();
          setMemories([]);
          setNotice('已清空全部长期记忆');
          notifyAssistant();
        } catch (reason: any) {
          setError(reason.message || '清空记忆失败');
        } finally {
          setModalLoading(false);
          setConfirmModal(null);
        }
      },
    });
  };

  const resetProfileToDefault = () => {
    setConfirmModal({
      title: '重置助理人设？',
      description: '重置后，小伴的称呼、Identity、Soul 与开场问候将恢复为默认初始状态。',
      icon: <RotateCcw size={20} />,
      confirmText: '确认重置',
      destructive: false,
      onConfirm: () => {
        setProfile({
          name: '小伴',
          avatar: '🌿',
          identity:
            '我是你的专属陪伴助理「小伴」。我了解你的工作习惯、日常生活偏好和当下状态，像一个一直在身边的默契好友，随时听你倾诉、陪你梳理思绪、在需要时给你温暖实用的建议。',
          soul:
            '真诚、温和、懂得倾听；不讲冰冷机械的客套话，像认识很久的朋友一样自然交流；在你疲惫或迷茫时给予理解和情绪支持，在你需要决策时耐心地陪你理清头绪。',
          greeting: '我在呢。今天过得怎么样？想随便聊聊，还是一起梳理点什么？',
          proactiveEnabled: true,
        });
        setNotice('已重置为默认陪伴人设，点击右上角「保存设置」后生效');
        setConfirmModal(null);
      },
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center py-24 text-slate-400">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  const activeMemoryCount = memories.filter((m) => m.status === 'ACTIVE').length;

  return (
    <div className="space-y-6">
      {/* 顶部标题栏与保存按钮 */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-400">
            <MessageCircleHeart size={15} />
            Personal Assistant
          </div>
          <h2 className="mt-1 text-2xl font-black text-slate-950">助理设置</h2>
        </div>
        <button
          type="button"
          onClick={saveProfile}
          disabled={saving || !profile.name.trim()}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
        >
          {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
          保存设置
        </button>
      </div>

      {(error || notice) && (
        <div
          className={cn(
            'rounded-2xl px-4 py-3 text-sm font-bold',
            error ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'
          )}
        >
          {error || notice}
        </div>
      )}

      {/* 卡片 1：陪伴人设与相处风格 */}
      <section className="rounded-[28px] border border-black/[0.06] bg-white p-6 sm:p-7 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-50 text-rose-500">
              <Heart size={16} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-950">人设与相处风格</h3>
              <p className="text-xs text-slate-400 font-medium">定制小伴的陪伴角色、说话语气与开场表达</p>
            </div>
          </div>
          <button
            type="button"
            onClick={resetProfileToDefault}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-black text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
            title="一键重置为默认陪伴人设"
          >
            <RotateCcw size={13} />
            <span>重置设定</span>
          </button>
        </div>

        {/* 陪伴风格推荐 */}
        <div className="rounded-2xl border border-black/[0.06] bg-[#fbfaf7] p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={15} className="text-amber-600" />
              <span className="text-xs font-black text-slate-800">精选陪伴风格（点击可一键载入成熟设定）</span>
            </div>
            <span className="text-[11px] text-slate-400 font-semibold">快速挑选适合你的相处方式</span>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {COMPANION_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset)}
                className="flex flex-col text-left rounded-xl border border-black/[0.07] bg-white p-3.5 transition hover:border-slate-950 hover:shadow-sm group cursor-pointer"
              >
                <div className="flex items-center justify-between gap-1.5 mb-1">
                  <span className="text-xs font-black text-slate-900 group-hover:text-black">{preset.name}</span>
                  <span className="text-base">{preset.avatar}</span>
                </div>
                <span className="text-[10px] font-bold text-slate-500 mb-1.5">{preset.tag}</span>
                <p className="text-[11px] text-slate-400 line-clamp-2 leading-4">{preset.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* 形象与称呼 */}
        <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-2">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-black/[0.08] bg-[#fbfaf7] text-2xl shadow-xs overflow-hidden">
              <Avatar src={profile.avatar || '🌿'} alt={profile.name || '小伴'} size="lg" />
              {uploadingAvatar && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                  <Loader2 size={18} className="animate-spin" />
                </div>
              )}
            </div>
            <span className="text-[11px] font-bold text-slate-400">当前形象</span>
          </div>

          <div className="space-y-3.5">
            <div>
              <label className="block text-xs font-black text-slate-600 mb-1.5">助理称呼</label>
              <input
                value={profile.name}
                onChange={(event) => changeProfile('name', event.target.value)}
                maxLength={24}
                className="h-11 w-full max-w-sm rounded-xl border border-black/10 bg-[#fbfaf7] px-3.5 text-sm font-semibold outline-none transition focus:border-slate-400 focus:bg-white"
                placeholder="例如：小伴"
              />
            </div>

            <div>
              <label className="block text-xs font-black text-slate-600 mb-1.5">专属形象设置</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleUploadAvatar}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-black/10 bg-white px-3 text-xs font-black text-slate-700 shadow-2xs hover:bg-slate-50 disabled:opacity-40 cursor-pointer"
                >
                  <Upload size={13} />
                  <span>上传专属图片</span>
                </button>
                <div className="h-4 w-[1px] bg-black/10 mx-1" />
                <span className="text-[11px] font-semibold text-slate-400">或选择温和质感标识：</span>
                <div className="flex flex-wrap items-center gap-1">
                  {COMPANION_EMBLEMS.map((emblem) => (
                    <button
                      key={emblem}
                      type="button"
                      onClick={() => changeProfile('avatar', emblem)}
                      className={cn(
                        'flex h-9 w-9 items-center justify-center rounded-xl text-base transition border cursor-pointer',
                        profile.avatar === emblem
                          ? 'border-slate-950 bg-slate-950 text-white shadow-xs'
                          : 'border-black/[0.08] bg-[#fbfaf7] hover:bg-slate-100'
                      )}
                    >
                      {emblem}
                    </button>
                  ))}
                </div>
              </div>
              <input
                value={profile.avatar || ''}
                onChange={(event) => changeProfile('avatar', event.target.value)}
                maxLength={500}
                className="mt-2 h-9 w-full max-w-md rounded-xl border border-black/10 bg-[#fbfaf7] px-3 text-xs font-semibold outline-none transition focus:border-slate-400 focus:bg-white"
                placeholder="支持粘贴自定义图片 URL 或 Emoji"
              />
            </div>
          </div>
        </div>

        {/* Identity */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-black text-slate-700">Identity · 陪伴定位与认知背景</label>
            <span className="text-[11px] text-slate-400 font-semibold">它扮演你的什么伙伴、应当了解你的哪些生活与工作习惯</span>
          </div>
          <textarea
            value={profile.identity || ''}
            onChange={(event) => changeProfile('identity', event.target.value)}
            maxLength={1000}
            rows={3}
            className="w-full resize-none rounded-xl border border-black/10 bg-[#fbfaf7] p-3.5 text-sm font-medium leading-6 outline-none transition focus:border-slate-400 focus:bg-white"
            placeholder="例如：我是你的专属陪伴助理「小伴」。我了解你的工作习惯、日常生活偏好和当下状态，像一个一直在身边的默契好友，随时听你倾诉、陪你梳理思绪、在需要时给你温暖实用的建议。"
          />
        </div>

        {/* Soul */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-black text-slate-700">Soul · 相处风格与沟通语气</label>
            <span className="text-[11px] text-slate-400 font-semibold">它和你说话时的说话方式、倾听习惯与关怀态度</span>
          </div>
          <textarea
            value={profile.soul || ''}
            onChange={(event) => changeProfile('soul', event.target.value)}
            maxLength={1000}
            rows={3}
            className="w-full resize-none rounded-xl border border-black/10 bg-[#fbfaf7] p-3.5 text-sm font-medium leading-6 outline-none transition focus:border-slate-400 focus:bg-white"
            placeholder="例如：真诚、温和、懂得倾听；不讲冰冷机械的客套话，像认识很久的朋友一样自然交流；在你疲惫或迷茫时给予理解和情绪支持，在你需要决策时耐心地陪你理清头绪。"
          />
        </div>

        {/* Greeting */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-black text-slate-700">开场问候 · Greeting</label>
            <span className="text-[11px] text-slate-400 font-semibold">每次新对话开启时助理的第一句问候</span>
          </div>
          <input
            value={profile.greeting || ''}
            onChange={(event) => changeProfile('greeting', event.target.value)}
            maxLength={300}
            className="h-11 w-full rounded-xl border border-black/10 bg-[#fbfaf7] px-3.5 text-sm font-semibold outline-none transition focus:border-slate-400 focus:bg-white"
            placeholder="我在呢。今天过得怎么样？想随便聊聊，还是一起梳理点什么？"
          />
        </div>

        {/* 在线主动陪伴开关 */}
        {(() => {
          const active = profile.proactiveEnabled !== false && (profile.proactiveEnabled as any) !== 0 && (profile.proactiveEnabled as any) !== '0';
          return (
            <div className="flex items-center justify-between rounded-2xl border border-black/[0.06] bg-[#fbfaf7] p-4">
              <div className="space-y-0.5 max-w-lg">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black text-slate-900">在线主动陪伴</span>
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black',
                      active ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-500'
                    )}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        active ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                      )}
                    />
                    {active ? '在线陪伴中' : '仅待命'}
                  </span>
                </div>
                <p className="text-xs text-slate-500 font-medium leading-5">
                  仅当你打开网页并在屏幕前使用时，小伴才会在合适时机（早安、午后、深夜等）在右下角轻声问候；关闭网页绝对不发，绝不自言自语。
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={active}
                onClick={handleToggleProactive}
                className={cn(
                  'relative h-6 w-11 shrink-0 rounded-full transition cursor-pointer',
                  active ? 'bg-emerald-600' : 'bg-slate-300'
                )}
              >
                <span
                  className={cn(
                    'absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition',
                    active ? 'left-6' : 'left-1'
                  )}
                />
              </button>
            </div>
          );
        })()}
      </section>

      {/* 卡片 2：长期记忆 */}
      <section className="rounded-[28px] border border-black/[0.06] bg-white p-6 sm:p-7 shadow-sm space-y-5">
        <div className="flex items-center justify-between border-b border-black/[0.06] pb-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <Brain size={16} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-black text-slate-950">长期记忆</h3>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-black text-emerald-700">
                  {activeMemoryCount} 条生效中
                </span>
              </div>
              <p className="text-xs text-slate-400 font-medium">全局跨会话生效，小伴只会记住你确认过的偏好与日常事实</p>
            </div>
          </div>
          {memories.length > 0 && (
            <button
              type="button"
              onClick={clearAllMemories}
              disabled={Boolean(memoryBusyId)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-black text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 cursor-pointer"
              title="一键清空所有长期记忆"
            >
              <Trash2 size={13} />
              <span>清空全部记忆</span>
            </button>
          )}
        </div>

        {/* 添加记忆条目栏 */}
        <div className="flex gap-2">
          <input
            value={newMemory}
            onChange={(event) => setNewMemory(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addMemory();
            }}
            maxLength={500}
            className="h-11 min-w-0 flex-1 rounded-xl border border-black/10 bg-[#fbfaf7] px-3.5 text-sm font-semibold outline-none transition focus:border-slate-400 focus:bg-white"
            placeholder="告诉小伴一条需要长期记住的偏好，例如：我平时喝咖啡不加糖、最近在学 Next.js..."
          />
          <button
            type="button"
            onClick={addMemory}
            disabled={!newMemory.trim() || saving}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-slate-950 px-4 text-xs font-black text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
          >
            <Plus size={16} />
            <span>添加</span>
          </button>
        </div>

        {/* 记忆列表 */}
        <div className="space-y-2.5 pt-1">
          {memories.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-black/10 py-12 text-center text-sm font-semibold text-slate-400">
              小伴还没有长期记忆，在上方输入一条添加吧
            </div>
          ) : (
            memories.map((item) => {
              const busy = memoryBusyId === item.id;
              const isActive = item.status === 'ACTIVE';
              return (
                <div
                  key={item.id}
                  className={cn(
                    'flex items-center gap-3.5 rounded-2xl border p-4 transition',
                    isActive
                      ? 'border-black/[0.08] bg-[#fbfaf7]'
                      : 'border-black/[0.04] bg-slate-50/50 opacity-60'
                  )}
                >
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isActive}
                    onClick={() => toggleMemory(item)}
                    disabled={busy}
                    title={isActive ? '点击停用' : '点击启用'}
                    className={cn(
                      'relative h-6 w-11 shrink-0 rounded-full transition cursor-pointer',
                      isActive ? 'bg-emerald-600' : 'bg-slate-300'
                    )}
                  >
                    <span
                      className={cn(
                        'absolute top-1 h-4 w-4 rounded-full bg-white shadow-sm transition',
                        isActive ? 'left-6' : 'left-1'
                      )}
                    />
                  </button>

                  <p
                    className={cn(
                      'min-w-0 flex-1 text-sm font-semibold leading-6',
                      isActive ? 'text-slate-800' : 'text-slate-400 line-through'
                    )}
                  >
                    {item.content}
                  </p>

                  <button
                    type="button"
                    onClick={() => requestDeleteMemory(item)}
                    disabled={busy}
                    aria-label="删除记忆"
                    title="删除此记忆"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40 cursor-pointer"
                  >
                    {busy ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(confirmModal)}
        title={confirmModal?.title || ''}
        description={confirmModal?.description}
        icon={confirmModal?.icon}
        confirmText={confirmModal?.confirmText || '确认'}
        cancelText="取消"
        destructive={confirmModal?.destructive}
        loading={modalLoading}
        onCancel={() => {
          if (!modalLoading) setConfirmModal(null);
        }}
        onConfirm={() => confirmModal?.onConfirm()}
      />
    </div>
  );
}
