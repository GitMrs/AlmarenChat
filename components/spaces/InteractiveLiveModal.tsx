'use client';

import { useEffect, useMemo, useState } from 'react';
import { Camera, CircleStop, MessageCircle, Pause, Play, Send, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import { streamSpaceMessage } from '@/lib/api';
import { useTTS } from '@/hooks/useTTS';
import type { Agent } from '@/types';
import luluImage from '@/src/lib/imgs/lulu.png';
import kekeImage from '@/src/lib/imgs/keke.png';

type LiveEvent =
  | { type: 'agent'; id: string; agent: Agent; content: string; replyTo?: string }
  | { type: 'audience'; id: string; content: string; answeredBy?: string };

const LIVE_CONTEXT_EVENT_LIMIT = 12;
const LIVE_STORAGE_EVENT_LIMIT = 80;

function compactLiveContent(content: string, maxLength = 1200) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function normalizeLiveEvents(value: unknown): LiveEvent[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((event, index): LiveEvent[] => {
    if (!event || typeof event !== 'object') return [];
    const item = event as Record<string, any>;
    if (item.type === 'audience' && typeof item.content === 'string') {
      return [{ type: 'audience', id: String(item.id || `audience-${index}`), content: item.content, answeredBy: typeof item.answeredBy === 'string' ? item.answeredBy : undefined }];
    }
    if (item.agent && typeof item.content === 'string' && typeof item.agent.id === 'string') {
      return [{ type: 'agent', id: String(item.id || `agent-${index}`), agent: item.agent as Agent, content: item.content, replyTo: typeof item.replyTo === 'string' ? item.replyTo : undefined }];
    }
    return [];
  }).slice(-LIVE_STORAGE_EVENT_LIMIT);
}

interface InteractiveLiveModalProps {
  isOpen: boolean;
  spaceId: string;
  spaceAgents: Agent[];
  onClose: () => void;
  onShareToSpace?: (content: string) => void;
}

async function readStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let content = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    content += decoder.decode(value, { stream: true });
  }
  return content.trim();
}

export default function InteractiveLiveModal({
  isOpen,
  spaceId,
  spaceAgents,
  onClose,
  onShareToSpace,
}: InteractiveLiveModalProps) {
  const [topic, setTopic] = useState('今晚聊聊：那些让人忍不住笑出来的游戏翻车瞬间');
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [status, setStatus] = useState<'setup' | 'live' | 'paused' | 'ended'>('setup');
  const [busy, setBusy] = useState(false);
  const [question, setQuestion] = useState('');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [error, setError] = useState('');
  const { play: playTTS, stop: stopTTS, isPlaying, isLoading } = useTTS();
  const storageKey = `almaren-live-session:${spaceId}`;

  const hosts = useMemo(() => {
    const find = (keywords: string[]) => spaceAgents.find((agent) => keywords.some((keyword) => agent.name.includes(keyword)));
    return {
      lulu: find(['璐璐']) || spaceAgents[0],
      keke: find(['可可']) || spaceAgents[1] || spaceAgents[0],
    };
  }, [spaceAgents]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { topic?: string; events?: unknown; turns?: unknown; status?: 'setup' | 'live' | 'paused' | 'ended' };
      if (parsed.topic) setTopic(parsed.topic);
      setEvents(normalizeLiveEvents(parsed.events ?? parsed.turns));
      if (parsed.status) setStatus(parsed.status);
    } catch {
      localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  useEffect(() => {
    if (status === 'setup' && events.length === 0) return;
    localStorage.setItem(storageKey, JSON.stringify({ topic, events: events.slice(-LIVE_STORAGE_EVENT_LIMIT), status }));
  }, [storageKey, status, topic, events]);

  if (!isOpen) return null;
  const agentTurns = events.filter((event): event is Extract<LiveEvent, { type: 'agent' }> => event.type === 'agent');
  const canStart = Boolean(hosts.lulu && hosts.keke && topic.trim());
  const nextHost = agentTurns.length > 0 && agentTurns[agentTurns.length - 1].agent.id === hosts.lulu.id ? hosts.keke : hosts.lulu;
  const latestTurn = agentTurns[agentTurns.length - 1];
  const activeHostId = busy ? nextHost.id : latestTurn?.agent.id;
  const latestExcerpt = latestTurn?.content.replace(/\s+/g, ' ').trim().slice(0, 48);
  const latestSpeakerName = latestTurn?.agent.name.split('·')[0].trim();
  const nextHostShortName = nextHost.name.split('·')[0].trim();
  const liveGroundingRules = '这是一个浏览器内的虚拟直播脚本，目前没有真实弹幕、在线观众消息或外部事实输入。不得编造观众用户名、弹幕内容、观众经历、实时观看人数、点赞量或“大家正在刷屏”等现场反应；不得把璐璐或可可虚构的过去经历说成已被系统证实的真实事实。需要举例时必须明确说“假设一个虚构例子”，并控制在简短口播范围内。';
  const liveAudienceRules = '你是在面对直播观众说话，不是在和另一位主播私聊。每段台词必须让观众单独看也能理解，优先回应主题或用户刚刚提出的问题。默认不要使用 @、不要向另一位主播提问、不要把结尾写成等待对方接招；只有确实需要对方补充时才自然提及一次，而且不要连续两段都点名。';

  const generateTurn = async (agent: Agent, prompt: string, persistUserMessage: boolean, contextEvents = events, replyTo?: string) => {
    setBusy(true);
    setError('');
    try {
      const result = await streamSpaceMessage({
        spaceId,
        message: prompt,
        history: contextEvents.filter((event) => event.id !== replyTo).slice(-LIVE_CONTEXT_EVENT_LIMIT).map((event) => event.type === 'audience'
          ? { role: 'user', content: `[观众提问${event.answeredBy ? '（已回答）' : ''}] ${compactLiveContent(event.content, 600)}` }
          : { role: 'assistant', content: `[${event.agent.name}] ${compactLiveContent(event.content)}`, speakerAgentId: event.agent.id }),
        targetAgentId: agent.id,
        interactionMode: 'multi_reply',
        skipPersistUserMessage: !persistUserMessage,
        webSearchEnabled: false,
        imageGenerationRequested: false,
        persistMessages: false,
        isolatedContext: true,
        contextAgentIds: [hosts.lulu.id, hosts.keke.id],
      });
      const content = await readStream(result.stream);
      if (!content) throw new Error('直播成员没有返回内容');
      const nextTurn: LiveEvent = { type: 'agent', id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, agent, content, replyTo };
      setEvents((current) => {
        const answered = replyTo
          ? current.map((event) => event.type === 'audience' && event.id === replyTo ? { ...event, answeredBy: agent.id } : event)
          : current;
        return [...answered, nextTurn].slice(-LIVE_STORAGE_EVENT_LIMIT);
      });
      if (voiceEnabled) {
        await playTTS(content, { id: `live-${Date.now()}`, voice: agent.voice });
      }
    } catch (err: any) {
      setError(err.message || '直播生成失败');
    } finally {
      setBusy(false);
    }
  };

  const startLive = async () => {
    if (!canStart || busy) return;
    setEvents([]);
    setStatus('live');
    await generateTurn(hosts.lulu, `${liveGroundingRules}\n${liveAudienceRules}\n你正在主持一场只有璐璐和可可参加的 AI 虚拟直播。主题是“${topic.trim()}”。请用自然、热闹、适合直播口播的方式开场，但只能泛泛称呼正在观看的人，不要假装看到了弹幕或观众回应。不要强行把话题交给可可。不要提及或邀请诺克斯及任何其他空间成员。只输出要对观众说的话。`, true, []);
  };

  const handoff = async () => {
    if (busy || status !== 'live') return;
    const hostName = nextHost.id === hosts.keke.id ? '可可' : '璐璐';
    await generateTurn(nextHost, `${liveGroundingRules}\n${liveAudienceRules}\n你正在参与只有璐璐和可可的 AI 虚拟直播。主题是“${topic.trim()}”。用户点击了“${nextHostShortName}接话”，所以现在轮到你面向观众继续说，不代表你必须向另一位主播传话。保持${hostName}自己的语气和风格；上一位主持人的内容是已发生的直播台词，不要重复整段或重新回答已经处理过的问题。不要声称收到了弹幕、看到了观众反应或记得未经提供的真实经历。可以进行轻松的虚构玩笑，但必须让它听起来像当场编的段子。不要提及或邀请其他空间成员。只输出要说的话。`, false);
  };

  const askQuestion = async () => {
    const value = question.trim();
    if (!value || busy || status !== 'live') return;
    setQuestion('');
    const audienceEvent: LiveEvent = { type: 'audience', id: `audience-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, content: value };
    const contextEvents = [...events, audienceEvent].slice(-LIVE_STORAGE_EVENT_LIMIT);
    setEvents(contextEvents);
    const hostName = nextHost.id === hosts.keke.id ? '可可' : '璐璐';
    await generateTurn(nextHost, `${liveGroundingRules}\n${liveAudienceRules}\n这是用户刚刚提交的真实提问：“${value}”\n请以${hostName}的身份直接回答，只依据这个问题和已有直播台词，不要补造用户没有提供的背景事实。回答重点放在用户的问题上，不要把问题转给另一位主播。控制在适合口播的长度，不要提及其他空间成员。`, false, contextEvents, audienceEvent.id);
  };

  const close = () => {
    stopTTS();
    onClose();
  };

  const clearSession = () => {
    if (!window.confirm('清空本场直播记录？')) return;
    stopTTS();
    localStorage.removeItem(storageKey);
    setEvents([]);
    setStatus('setup');
    setQuestion('');
    setError('');
  };

  const renderLiveEvent = (event: LiveEvent, index: number) => {
    if (event.type === 'audience') {
      return <article key={event.id} className="rounded-xl border border-dashed border-amber-200 bg-amber-50/60 px-3 py-2"><div className="flex items-center gap-2 text-[11px] font-black text-amber-700"><span>观众提问</span>{event.answeredBy && <span className="font-semibold text-slate-400">已回应</span>}</div><p className="mt-1 text-xs leading-5 text-slate-600">{event.content}</p></article>;
    }
    const agentIndex = events.slice(0, index).filter((item) => item.type === 'agent').length + 1;
    return <article key={event.id} className="rounded-2xl border border-rose-100 bg-[#fffaf5] p-3"><div className="flex items-center gap-2 text-xs font-black text-amber-700"><span>{event.agent.name}</span><span className="text-slate-300">#{agentIndex}</span></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{event.content}</p></article>;
  };

  return (
    <div className="fixed inset-0 z-[80] flex bg-[#fffaf5] text-slate-950">
      <div className="flex h-full w-full flex-col overflow-hidden bg-[#fffaf5]">
        <header className="flex shrink-0 items-center justify-between border-b border-rose-100 bg-white px-4 py-3 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-600"><Camera size={19} /></div>
            <div>
              <h2 className="text-base font-black sm:text-lg">AI 虚拟直播</h2>
              <p className="text-[11px] font-semibold text-slate-400">璐璐 × 可可 · 浏览器直播间</p>
            </div>
          </div>
          <button type="button" onClick={close} title="关闭直播间" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-slate-950"><X size={18} /></button>
        </header>

        {status === 'setup' ? (
          <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-5 sm:p-10 lg:grid-cols-[1fr_1fr] lg:items-center lg:px-[8vw]">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-rose-500">Live room / 01</p>
              <h3 className="mt-3 text-3xl font-black leading-tight text-slate-950 sm:text-5xl">让她们替你<br /><span className="text-amber-600">把话题聊起来</span></h3>
              <p className="mt-4 max-w-xl text-sm leading-6 text-slate-500">先从一场短直播开始。璐璐负责控场和吐槽，可可负责接梗和照顾观众；每段内容生成后按顺序显示。</p>
              <label className="mt-8 block text-xs font-black text-slate-600">直播主题</label>
              <textarea value={topic} onChange={(event) => setTopic(event.target.value)} rows={3} className="mt-2 w-full resize-none rounded-xl border border-rose-100 bg-white px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-rose-300 focus:ring-2 focus:ring-rose-100" />
              <button type="button" onClick={startLive} disabled={!canStart || busy} className="mt-5 inline-flex h-11 items-center gap-2 rounded-xl bg-rose-500 px-5 text-sm font-black text-white shadow-lg shadow-rose-950/30 transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-40"><Play size={16} fill="currentColor" />开始直播</button>
            </div>
            <div className="relative flex min-h-[340px] items-end justify-center overflow-hidden rounded-3xl border border-rose-100 bg-[radial-gradient(circle_at_50%_20%,#ffe4e6,#fff7ed_55%,#fce7f3)] p-4">
              <img src={luluImage.src} alt="璐璐立绘" className="absolute bottom-0 left-2 h-[92%] w-[52%] object-contain object-bottom drop-shadow-2xl" />
              <img src={kekeImage.src} alt="可可立绘" className="absolute bottom-0 right-1 h-[82%] w-[52%] object-contain object-bottom drop-shadow-2xl" />
              <div className="relative z-10 mb-2 rounded-full border border-white/80 bg-white/75 px-3 py-1 text-[11px] font-black text-slate-700 shadow-sm backdrop-blur">双人直播舞台预览</div>
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,520px)]">
            <section className="relative flex min-h-[44vh] flex-col overflow-hidden border-b border-rose-100 bg-[radial-gradient(circle_at_50%_15%,#ffe4e6,#fff7ed_52%,#fce7f3)] p-4 sm:min-h-[52vh] sm:p-8 lg:min-h-0 lg:border-b-0 lg:border-r">
              <img src={luluImage.src} alt="璐璐立绘" className={`absolute bottom-0 left-0 h-[90%] w-[57%] object-contain object-bottom drop-shadow-2xl transition duration-500 ${activeHostId === hosts.lulu.id ? 'scale-[1.04] opacity-100' : busy ? 'pointer-events-none opacity-30' : 'opacity-65'}`} />
              <img src={kekeImage.src} alt="可可立绘" className={`absolute bottom-0 right-0 h-[82%] w-[55%] object-contain object-bottom drop-shadow-2xl transition duration-500 ${activeHostId === hosts.keke.id ? 'scale-[1.04] opacity-100' : busy ? 'pointer-events-none opacity-30' : 'opacity-65'}`} />
              <div className="absolute left-4 right-4 top-4 z-10 sm:left-8 sm:right-8">
                <div className="flex items-center justify-between gap-3 rounded-full border border-white/80 bg-white/80 px-4 py-2.5 shadow-sm backdrop-blur-md"><span className="min-w-0 truncate text-xs font-black text-rose-600">● LIVE · {topic}</span><span className="shrink-0 text-[11px] font-bold text-slate-400">{agentTurns.length} 段</span></div>
              </div>
              <div className="absolute bottom-5 left-4 right-4 z-10 sm:bottom-8 sm:left-8 sm:right-8">
                {busy && <div className={`mb-2 flex ${nextHost.id === hosts.keke.id ? 'justify-end' : 'justify-start'}`}><span className="rounded-full border border-white/80 bg-white/85 px-3 py-1 text-[11px] font-black text-slate-500 shadow-sm backdrop-blur">{nextHost.name.split('·')[0].trim()} 正在发言…</span></div>}
                {latestTurn && <div className={`hidden max-w-sm rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-lg backdrop-blur-md lg:block ${latestTurn.agent.id === hosts.keke.id ? 'ml-auto text-right' : 'mr-auto'}`}><div className="mb-1 flex items-center gap-2 text-[11px] font-black text-slate-500"><span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-600">{latestSpeakerName}</span><span>最新台词</span></div><p className="max-h-12 overflow-hidden text-sm font-semibold leading-6 text-slate-700">{latestExcerpt}{latestTurn.content.length > 48 ? '…' : ''}</p></div>}
              </div>
            </section>
            <section className="flex min-h-0 flex-col bg-white lg:max-w-[520px]">
              <div className="border-b border-rose-100 px-4 py-4 sm:px-8">
                <div className="flex items-center justify-between"><div><h3 className="text-lg font-black text-slate-900">现场对话</h3><p className="mt-1 text-xs font-semibold text-slate-400">本场内容仅保存在直播间</p></div><div className="flex gap-1.5"><span className={`rounded-full px-2 py-1 text-[10px] font-black ${activeHostId === hosts.lulu.id ? 'bg-rose-100 text-rose-600' : 'bg-slate-100 text-slate-400'}`}>璐璐</span><span className={`rounded-full px-2 py-1 text-[10px] font-black ${activeHostId === hosts.keke.id ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'}`}>可可</span></div></div>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-8">
                {events.length === 0 && <p className="py-10 text-center text-sm font-semibold text-slate-400">直播即将开始…</p>}
                {events.map(renderLiveEvent)}
                {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600">{error}</p>}
              </div>
              <div className="shrink-0 border-t border-rose-100 p-4 sm:p-5">
                <div className="flex flex-nowrap gap-2 overflow-x-auto pb-0.5">
                  <button type="button" onClick={handoff} disabled={busy || status !== 'live'} title={`让${nextHost.name}接话`} className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-amber-400 px-3 text-xs font-black text-slate-950 disabled:opacity-40"><MessageCircle size={14} />{nextHostShortName}接话</button>
                  <button type="button" onClick={() => { setVoiceEnabled((enabled) => !enabled); stopTTS(); }} title={voiceEnabled ? '关闭语音' : '开启语音'} className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-rose-100 px-3 text-xs font-black text-slate-600">{voiceEnabled ? <Volume2 size={14} className="text-amber-600" /> : <VolumeX size={14} />}语音</button>
                  <button type="button" onClick={() => setStatus((value) => value === 'paused' ? 'live' : 'paused')} disabled={busy || status === 'ended'} title={status === 'paused' ? '继续直播' : '暂停直播'} className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-rose-100 px-3 text-xs font-black text-slate-600 disabled:opacity-40">{status === 'paused' ? <Play size={14} /> : <Pause size={14} />}{status === 'paused' ? '继续' : '暂停'}</button>
                  <button type="button" onClick={clearSession} disabled={busy} title="清空本场直播记录" className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 px-3 text-xs font-black text-slate-500 disabled:opacity-40"><Trash2 size={14} />清空</button>
                  <button type="button" onClick={() => { stopTTS(); setStatus('ended'); }} title="结束直播" className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-rose-200 px-3 text-xs font-black text-rose-600"><CircleStop size={14} />结束</button>
                  {(isPlaying || isLoading) && <span className="ml-auto inline-flex items-center gap-1.5 text-xs font-bold text-slate-400"><Volume2 size={14} className="text-amber-600" />正在播放</span>}
                </div>
                <div className="mt-3 flex gap-2"><input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void askQuestion(); }} placeholder="发送一条观众提问…" disabled={busy || status !== 'live'} className="min-w-0 flex-1 rounded-lg border border-rose-100 bg-[#fffaf5] px-3 py-2 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-rose-300" /><button type="button" onClick={askQuestion} disabled={!question.trim() || busy || status !== 'live'} title="发送提问" className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-500 text-white disabled:opacity-30"><Send size={15} /></button></div>
                {status === 'ended' && <button type="button" onClick={() => onShareToSpace?.(`AI 虚拟直播「${topic}」已结束，共生成 ${agentTurns.length} 段直播内容。`)} className="mt-3 text-xs font-black text-amber-600 hover:text-amber-700">把直播摘要发回空间</button>}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
