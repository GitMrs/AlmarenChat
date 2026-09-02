'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Globe2, Loader2, Menu, MessageCircleHeart, PanelRightClose, Send, Settings2, Square } from 'lucide-react';
import MessageBubbleFrame from '@/components/chat/MessageBubbleFrame';
import MessageContent from '@/components/chat/MessageContent';
import { assistant, type AssistantPageContext } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Message, PersonalAssistantBootstrap } from '@/types';

const HIDDEN_PATHS = ['/login'];

function inferPageContext(pathname: string): AssistantPageContext | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] === 'spaces' && parts[1]) return { type: 'space', spaceId: parts[1] };
  if (parts[0] === 'conversations' && parts[1]) return { type: 'conversation', conversationId: parts[1] };
  if ((parts[0] === 'agents' || parts[0] === 'chat') && parts[1]) return { type: 'agent', agentId: parts[1] };
  return null;
}

function AssistantLauncher({ open, onClick }: { open: boolean; onClick: () => void }) {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="打开个人助理"
      title="个人助理"
      style={{
        bottom: mobile ? 'calc(80px + env(safe-area-inset-bottom, 0px))' : '24px',
        position: 'fixed',
        right: mobile ? '16px' : '24px',
        zIndex: 65,
      }}
      className={cn(
        'fixed right-4 z-[65] flex h-11 w-11 items-center justify-center rounded-full border border-black/10 bg-white text-slate-700 shadow-lg transition hover:-translate-y-0.5 hover:text-slate-950',
        'md:right-6',
        open && 'pointer-events-none scale-90 opacity-0'
      )}
    >
      <MessageCircleHeart size={21} />
    </button>
  );
}

export default function PersonalAssistantProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<PersonalAssistantBootstrap | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const [webEnabled, setWebEnabled] = useState(false);
  const [sharePage, setSharePage] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [mobile, setMobile] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pageContext = useMemo(() => inferPageContext(pathname), [pathname]);
  const hidden = HIDDEN_PATHS.some((path) => pathname.startsWith(path));

  useEffect(() => {
    setLoggedIn(Boolean(localStorage.getItem('token')));
  }, [pathname]);
  useEffect(() => {
    const invalidate = () => setData(null);
    window.addEventListener('personal-assistant-updated', invalidate);
    return () => window.removeEventListener('personal-assistant-updated', invalidate);
  }, []);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => setMobile(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  const load = useCallback(async () => {
    if (!localStorage.getItem('token') || data || loading) return;
    setLoading(true);
    setError('');
    try {
      setData(await assistant.get());
    } catch (err: any) {
      if (err.message !== 'Unauthorized') setError(err.message || '助理加载失败');
    } finally {
      setLoading(false);
    }
  }, [data, loading]);

  useEffect(() => {
    if (open) load();
  }, [open, pathname, load]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [data?.messages, streaming, open]);
  useEffect(() => {
    if (!pageContext) setSharePage(false);
  }, [pageContext]);

  const send = async () => {
    const content = input.trim();
    if (!content || streaming || !data) return;
    const now = new Date().toISOString();
    const userMessage: Message = { id: `local-user-${Date.now()}`, conversationId: data.conversationId, role: 'user', content, createdAt: now };
    const assistantMessage: Message = { id: `local-assistant-${Date.now()}`, conversationId: data.conversationId, role: 'assistant', content: '', createdAt: now };
    setData({ ...data, messages: [...data.messages, userMessage, assistantMessage] });
    setInput('');
    setError('');
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await assistant.sendMessage({ message: content, webSearchEnabled: webEnabled, sharePage, pageContext, signal: controller.signal });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error('模型没有返回内容');
      let answer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setData((current) => current ? {
          ...current,
          messages: current.messages.map((message) => message.id === assistantMessage.id ? { ...message, content: answer } : message),
        } : current);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(err.message || '发送失败');
      setData((current) => current ? { ...current, messages: current.messages.filter((message) => message.id !== assistantMessage.id || message.content) } : current);
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  return (
    <>
      {children}
      {!hidden && loggedIn && <AssistantLauncher open={open} onClick={() => setOpen(true)} />}
      {!hidden && loggedIn && open && (
        <div className="fixed inset-0 z-[70] md:pointer-events-none" style={{ position: 'fixed', inset: 0, zIndex: 70 }}>
          <button type="button" aria-label="关闭个人助理" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/20 backdrop-blur-[2px] md:pointer-events-auto md:bg-black/10" />
          <aside
            className="pointer-events-auto absolute flex flex-col overflow-hidden bg-[#fbfaf7] shadow-2xl md:rounded-lg md:border md:border-black/10"
            style={mobile
              ? { inset: 0 }
              : { top: 12, right: 12, bottom: 12, width: 430, borderRadius: 8, border: '1px solid rgb(0 0 0 / 0.1)' }}
          >
            <header className="flex h-16 shrink-0 items-center gap-3 border-b border-black/[0.06] bg-white/80 px-4 backdrop-blur">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-950 text-white"><MessageCircleHeart size={18} /></div>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-sm font-black text-slate-900">{data?.profile.name || '个人助理'}</h1>
                <p className="text-[11px] font-semibold text-slate-400">陪你聊天，也帮你看清平台里的事</p>
              </div>
              <button onClick={() => { setOpen(false); router.push('/me?tab=assistant'); }} aria-label="助理设置" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><Settings2 size={17} /></button>
              <button onClick={() => setOpen(false)} aria-label="关闭个人助理" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><PanelRightClose size={18} /></button>
            </header>
            <div ref={listRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5">
              {loading && <div className="flex h-full items-center justify-center"><Loader2 size={20} className="animate-spin text-slate-400" /></div>}
              {!loading && data && data.messages.length === 0 && (
                <div className="mx-auto flex min-h-full max-w-xs flex-col items-center justify-center pb-16 text-center">
                  <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-black/[0.08] bg-white shadow-sm"><MessageCircleHeart size={25} /></div>
                  <p className="text-base font-black text-slate-800">{data.profile.greeting || '我在，今天想聊什么？'}</p>
                </div>
              )}
              {data?.messages.map((message) => (
                <MessageBubbleFrame key={message.id} role={message.role} avatar={data.profile.avatar || '◉'} agentName={data.profile.name} userColor="#0f172a" showAgentName={false}>
                  {message.content ? <MessageContent role={message.role} content={message.content} /> : <span className="inline-flex gap-1 py-1"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:120ms]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:240ms]" /></span>}
                </MessageBubbleFrame>
              ))}
            </div>
            <div className="shrink-0 border-t border-black/[0.06] bg-white/90 px-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur">
              {error && <p className="mb-2 px-1 text-xs font-bold text-rose-600">{error}</p>}
              <div className="mb-2 flex min-h-7 flex-wrap items-center gap-1.5">
                <button type="button" onClick={() => setWebEnabled((value) => !value)} className={cn('flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-black', webEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500')}><Globe2 size={12} />联网</button>
                <button type="button" disabled={!pageContext} onClick={() => setSharePage((value) => !value)} className={cn('flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] font-black disabled:opacity-35', sharePage ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500')}><Menu size={12} />结合当前页面</button>
              </div>
              <div className="flex items-end gap-2 rounded-lg border border-black/[0.08] bg-[#fbfaf7] p-2 shadow-sm focus-within:border-slate-300">
                <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} rows={1} className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 outline-none" placeholder="和我说点什么..." />
                {streaming ? <button onClick={() => abortRef.current?.abort()} aria-label="停止生成" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-rose-500 text-white"><Square size={15} /></button> : <button onClick={send} disabled={!input.trim() || !data} aria-label="发送" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-white disabled:opacity-30"><Send size={16} /></button>}
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
