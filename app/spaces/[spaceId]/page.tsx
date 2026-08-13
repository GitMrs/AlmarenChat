'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, FileText, Loader2, Plus, Send, Square, UploadCloud, UsersRound } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AppShell from '@/components/layout/AppShell';
import Avatar from '@/components/shared/Avatar';
import LoginRequired from '@/components/auth/LoginRequired';
import SpaceMessageItem from '@/components/spaces/SpaceMessageItem';
import { agents as agentsApi, spaces as spacesApi, streamSpaceMessage } from '@/lib/api';
import { getBuiltInAgents } from '@/lib/agents-data';
import type { Agent, SpaceFile, SpaceMessage } from '@/types';

const FALLBACK_COLOR = '#4f46e5';
const SPACE_COORDINATOR_ID = 'space-coordinator';
const DEFAULT_COORDINATOR = {
  id: SPACE_COORDINATOR_ID,
  name: '空间协调者',
  avatar: '🧭',
  category: '协调者',
  description: '默认接收未 @ 的消息，负责理解需求和协调成员。',
};

function formatBytes(value?: number | null) {
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export default function SpaceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const spaceId = params.spaceId as string;
  const [space, setSpace] = useState<any | null>(null);
  const [messages, setMessages] = useState<SpaceMessage[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [files, setFiles] = useState<SpaceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingSpeakerId, setStreamingSpeakerId] = useState<string | null>(null);
  const [addingAgentId, setAddingAgentId] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const agentById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const memberAgents = useMemo(
    () => (space?.members || []).map((member: any) => agentById.get(member.agentId)).filter(Boolean) as Agent[],
    [agentById, space]
  );
  const availableAgents = useMemo(
    () => agents.filter((agent) => !(space?.members || []).some((member: any) => member.agentId === agent.id)),
    [agents, space]
  );
  const coordinatorAgent = useMemo(() => space?.hostAgent || DEFAULT_COORDINATOR, [space]);
  const speakerById = useMemo(() => {
    const map = new Map<string, any>(agents.map((agent) => [agent.id, agent]));
    map.set(coordinatorAgent.id, coordinatorAgent);
    return map;
  }, [agents, coordinatorAgent]);

  const load = async () => {
    if (!localStorage.getItem('token')) {
      setNeedsLogin(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [spaceResult, messageResult, fileResult, builtIn, customResult] = await Promise.all([
        spacesApi.get(spaceId),
        spacesApi.messages(spaceId, { limit: 60 }),
        spacesApi.files(spaceId),
        getBuiltInAgents(),
        agentsApi.mine().catch(() => ({ agents: [] })),
      ]);
      setAgents([...customResult.agents, ...builtIn]);
      setSpace(spaceResult.space);
      setMessages(messageResult.messages);
      setFiles(fileResult.files);
    } catch (err: any) {
      setError(err.message || '加载空间失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [spaceId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: isStreaming ? 'auto' : 'smooth' });
  }, [messages.length, streamingContent, isStreaming]);

  const refreshSpace = async () => {
    const result = await spacesApi.get(spaceId);
    setSpace(result.space);
  };

  const addMember = async () => {
    if (!addingAgentId) return;
    await spacesApi.addMember(spaceId, { agentId: addingAgentId });
    setAddingAgentId('');
    await refreshSpace();
  };

  const removeMember = async (memberId: string) => {
    await spacesApi.removeMember(spaceId, memberId);
    await refreshSpace();
  };

  const uploadFile = async (file?: File) => {
    if (!file || uploadingFile) return;
    setUploadingFile(true);
    setError('');
    try {
      const result = await spacesApi.uploadFile(spaceId, file);
      setFiles((items) => [result.file, ...items]);
    } catch (err: any) {
      setError(err.message || '上传资料失败');
    } finally {
      setUploadingFile(false);
    }
  };

  const insertMention = (agent: Agent) => {
    setInput((current) => {
      const prefix = current.trim() ? `${current.trimEnd()} ` : '';
      return `${prefix}@${agent.name} `;
    });
  };

  const send = async () => {
    const content = input.trim();
    if (!content || isStreaming) return;

    const userMessage: SpaceMessage = {
      id: `user-${Date.now()}`,
      spaceId,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');
    setStreamingSpeakerId(null);

    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const result = await streamSpaceMessage({
        spaceId,
        message: content,
        history: nextMessages.map((message) => ({
          role: message.role,
          content: message.content,
          speakerAgentId: message.speakerAgentId,
        })),
        signal: controller.signal,
      });
      setStreamingSpeakerId(result.speakerAgentId || null);

      const reader = result.stream.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullContent += chunk;
        setStreamingContent(fullContent);
      }

      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          spaceId,
          role: 'assistant',
          speakerAgentId: result.speakerAgentId,
          content: fullContent,
          createdAt: new Date().toISOString(),
        },
      ]);
      await refreshSpace();
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError(err.message || '发送失败');
      }
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setStreamingContent('');
  };

  if (loading) {
    return (
      <AppShell>
        <div className="flex justify-center py-24 text-slate-400">
          <Loader2 className="animate-spin" size={24} />
        </div>
      </AppShell>
    );
  }

  if (needsLogin) {
    return (
      <AppShell>
        <div className="py-8">
          <LoginRequired title="登录后进入空间" description="空间会保存成员、消息和资料，需要登录后使用。" />
        </div>
      </AppShell>
    );
  }

  if (!space) {
    return (
      <AppShell>
        <div className="py-20 text-center text-sm font-bold text-slate-400">空间不存在</div>
      </AppShell>
    );
  }

  const streamingSpeaker = streamingSpeakerId ? speakerById.get(streamingSpeakerId) : coordinatorAgent;

  return (
    <AppShell>
      <div className="py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => router.push('/spaces')}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-sm font-black text-slate-600 shadow-sm transition hover:text-slate-950"
          >
            <ArrowLeft size={16} />
            返回空间
          </button>
        </div>

        <div className="grid min-h-[calc(100dvh-160px)] overflow-hidden rounded-[32px] border border-black/[0.06] bg-white shadow-sm lg:grid-cols-[280px_minmax(0,1fr)_280px]">
          <aside className="border-b border-black/[0.06] bg-[#fbfaf7] p-5 lg:border-b-0 lg:border-r">
            <h1 className="text-2xl font-black text-slate-950">{space.name}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">{space.description || '这个空间还没有说明。'}</p>

            <div className="mt-6">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-700">
                <UsersRound size={16} />
                空间成员
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-2">
                  <Avatar src={coordinatorAgent.avatar || '🧭'} alt={coordinatorAgent.name} size="sm" />
                  <button type="button" onClick={() => insertMention(coordinatorAgent as Agent)} className="min-w-0 flex-1 text-left">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate text-sm font-black text-slate-800">{coordinatorAgent.name}</div>
                      <span className="shrink-0 rounded-full bg-slate-950 px-2 py-0.5 text-[10px] font-black text-white">
                        默认
                      </span>
                    </div>
                    <div className="truncate text-xs font-semibold text-slate-400">空间协调者</div>
                  </button>
                </div>
                {(space.members || []).map((member: any) => {
                  const agent = agentById.get(member.agentId);
                  return (
                    <div key={member.id} className="flex items-center gap-3 rounded-2xl bg-white px-3 py-2">
                      <Avatar src={agent?.avatar || '🤖'} alt={agent?.name || 'Agent'} size="sm" />
                      <button type="button" onClick={() => agent && insertMention(agent)} className="min-w-0 flex-1 text-left">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="truncate text-sm font-black text-slate-800">{agent?.name || member.agentId}</div>
                        </div>
                        <div className="truncate text-xs font-semibold text-slate-400">{member.roleName || agent?.category || 'Agent'}</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeMember(member.id)}
                        className="text-xs font-black text-slate-300 transition hover:text-rose-500"
                      >
                        移除
                      </button>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex gap-2">
                <select
                  value={addingAgentId}
                  onChange={(event) => setAddingAgentId(event.target.value)}
                  className="h-10 min-w-0 flex-1 rounded-2xl border border-black/[0.08] bg-white px-3 text-xs font-bold text-slate-700 outline-none"
                >
                  <option value="">添加 Agent</option>
                  {availableAgents.slice(0, 80).map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addMember}
                  disabled={!addingAgentId}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white disabled:bg-slate-200 disabled:text-slate-400"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </aside>

          <main className="flex min-h-[620px] min-w-0 flex-col">
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-[#fbfaf7] px-4 py-5 sm:px-6">
              <div className="mx-auto max-w-3xl space-y-5">
                {error && <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{error}</div>}
                {messages.length === 0 && !isStreaming && (
                  <div className="rounded-[28px] border border-dashed border-slate-200 bg-white p-8 text-center">
                    <h2 className="text-lg font-black text-slate-950">先把需求交给协调者</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      直接发送会由空间协调者接话；明确 @ 成员时，会交给对应成员回应。
                    </p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => insertMention(coordinatorAgent as Agent)}
                        className="rounded-full bg-slate-950 px-4 py-2 text-sm font-black text-white transition hover:bg-slate-800"
                      >
                        @{coordinatorAgent.name}
                      </button>
                      {memberAgents.slice(0, 4).map((agent) => (
                        <button
                          key={agent.id}
                          type="button"
                          onClick={() => insertMention(agent)}
                          className="rounded-full bg-[#fbfaf7] px-4 py-2 text-sm font-black text-slate-600 transition hover:bg-slate-950 hover:text-white"
                        >
                          @{agent.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((message) => (
                  <SpaceMessageItem
                    key={message.id}
                    message={message}
                    speaker={message.speakerAgentId ? speakerById.get(message.speakerAgentId) : null}
                    fallbackColor={FALLBACK_COLOR}
                  />
                ))}
                {isStreaming && streamingContent && (
                  <div className="flex justify-start gap-3">
                    <Avatar src={streamingSpeaker?.avatar || '🤖'} alt={streamingSpeaker?.name || 'Agent'} size="sm" className="mt-1 shrink-0" />
                    <div className="min-w-0 max-w-[84%] rounded-[24px] rounded-bl-md border border-black/[0.06] bg-white px-5 py-4 text-slate-800 shadow-sm">
                      <div className="mb-1 text-xs font-black text-slate-400">{streamingSpeaker?.name || '空间 Agent'}</div>
                      <div className="markdown-body min-w-0 max-w-full overflow-hidden text-sm leading-7">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                )}
                {isStreaming && !streamingContent && (
                  <div className="flex justify-start gap-3">
                    <Avatar src={streamingSpeaker?.avatar || '🤖'} alt={streamingSpeaker?.name || 'Agent'} size="sm" className="mt-1 shrink-0" />
                    <div className="rounded-[24px] rounded-bl-md border border-black/[0.06] bg-white px-5 py-4 shadow-sm">
                      <div className="flex gap-1.5">
                        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:150ms]" />
                        <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:300ms]" />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <footer className="border-t border-black/[0.06] bg-white p-4">
              <div className="mx-auto flex max-w-3xl items-end gap-3 rounded-[28px] border border-black/[0.08] bg-[#fbfaf7] p-2 shadow-sm">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      send();
                    }
                  }}
                  placeholder={`不 @ 时由 ${coordinatorAgent.name} 接话...`}
                  rows={1}
                  className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-4 py-3 text-sm font-medium leading-6 text-slate-800 outline-none placeholder:text-slate-400"
                />
                {isStreaming ? (
                  <button onClick={stop} className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-500 text-white">
                    <Square size={17} />
                  </button>
                ) : (
                  <button
                    onClick={send}
                    disabled={!input.trim()}
                    className="mb-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white disabled:bg-slate-200 disabled:text-slate-400"
                  >
                    <Send size={17} />
                  </button>
                )}
              </div>
            </footer>
          </main>

          <aside className="border-t border-black/[0.06] bg-white p-5 lg:border-l lg:border-t-0">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-black text-slate-700">
                <FileText size={16} />
                空间资料
              </div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  uploadFile(file);
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFile}
                className="inline-flex h-9 items-center gap-1 rounded-full bg-slate-950 px-3 text-xs font-black text-white disabled:bg-slate-200 disabled:text-slate-400"
              >
                {uploadingFile ? <Loader2 className="animate-spin" size={14} /> : <UploadCloud size={14} />}
                上传
              </button>
            </div>
            <div className="rounded-2xl bg-[#fbfaf7] px-4 py-3 text-xs font-semibold leading-5 text-slate-500">
              资料会保存到当前空间的隔离目录。第一版先支持上传和留存，后续再接入资料检索。
            </div>
            <div className="mt-4 space-y-2">
              {files.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 p-5 text-center text-sm font-semibold text-slate-400">
                  暂无资料
                </div>
              ) : (
                files.map((file) => (
                  <div key={file.id} className="rounded-2xl border border-black/[0.06] bg-white px-3 py-3">
                    <div className="truncate text-sm font-black text-slate-800">{file.fileName}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-400">{formatBytes(file.size)}</div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
