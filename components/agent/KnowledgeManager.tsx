'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Bookmark, Check, ChevronDown, ChevronRight, Copy, Database, Download, FileText, Loader2, Search, Trash2, UploadCloud, X } from 'lucide-react';
import { agents, downloadKnowledgeFile, spaces } from '@/lib/client/api';
import { cn } from '@/lib/client/utils';

type KnowledgeDocument = {
  id: string;
  fileName: string;
  size?: number | null;
  sourceType?: string | null;
  status?: string | null;
  sourceUrl?: string | null;
  summary?: string | null;
  createdAt: string;
  _count?: {
    chunks: number;
  };
};

type KnowledgeChunk = {
  id: string;
  chunkIndex: number;
  title?: string | null;
  content: string;
  createdAt: string;
};

type KnowledgeHit = {
  id: string;
  documentId: string;
  chunkIndex: number;
  title?: string | null;
  content: string;
  fileName: string;
  score: number;
};

function formatBytes(value?: number | null) {
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function KnowledgeManager({
  agentId,
  agentName,
  spaceId,
  spaceName,
  onClose,
}: {
  agentId?: string | null;
  agentName?: string;
  spaceId?: string | null;
  spaceName?: string;
  onClose?: () => void;
}) {
  const isSpace = Boolean(spaceId);
  const targetId = spaceId || agentId;
  const targetTitle = isSpace ? (spaceName || '当前空间') : (agentName || '当前 Agent');

  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [expandedDocumentId, setExpandedDocumentId] = useState('');
  const [loadingChunksId, setLoadingChunksId] = useState('');
  const [chunksByDocumentId, setChunksByDocumentId] = useState<Record<string, KnowledgeChunk[]>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [searchHits, setSearchHits] = useState<KnowledgeHit[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [viewingDoc, setViewingDoc] = useState<{ id: string; fileName: string; content: string } | null>(null);
  const [loadingRawId, setLoadingRawId] = useState('');
  const [copied, setCopied] = useState(false);

  const clearSearch = () => {
    setSearchQuery('');
    setHasSearched(false);
    setSearchHits([]);
  };

  const loadDocuments = async () => {
    if (!targetId) return;

    setLoading(true);
    setError('');
    try {
      const result = isSpace
        ? await spaces.knowledge(targetId)
        : await agents.knowledge(targetId);
      setDocuments(result.documents);
    } catch (err: any) {
      setError(err.message || '加载知识库失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [targetId]);

  const uploadKnowledge = async (file?: File) => {
    if (!targetId || !file || uploading) return;

    setUploading(true);
    setError('');
    setNotice('');
    try {
      const result = isSpace
        ? await spaces.uploadKnowledge(targetId, file)
        : await agents.uploadKnowledge(targetId, file);
      setNotice(`已上传 ${file.name}，智能识别章节并生成 ${result.chunkCount} 个向量切片。`);
      await loadDocuments();
    } catch (err: any) {
      setError(err.message || '上传知识库失败');
    } finally {
      setUploading(false);
    }
  };

  const viewFullDocument = async (document: KnowledgeDocument) => {
    if (!targetId || loadingRawId) return;
    setLoadingRawId(document.id);
    setError('');
    try {
      const res = isSpace
        ? await spaces.knowledgeRaw(targetId, document.id)
        : await agents.knowledgeRaw(targetId, document.id);
      setViewingDoc({ id: document.id, fileName: document.fileName, content: res.content });
      setCopied(false);
    } catch (err: any) {
      setError(err.message || '加载全文失败');
    } finally {
      setLoadingRawId('');
    }
  };

  const deleteDocument = async (document: KnowledgeDocument) => {
    if (!targetId || deletingId) return;
    if (!window.confirm(`确定删除「${document.fileName}」及其关联的向量切片吗？`)) return;

    setDeletingId(document.id);
    setError('');
    setNotice('');
    try {
      if (isSpace) {
        await spaces.deleteKnowledge(targetId, document.id);
      } else {
        await agents.deleteKnowledge(targetId, document.id);
      }
      setDocuments((items) => items.filter((item) => item.id !== document.id));
      setNotice(`已删除 ${document.fileName}。`);
    } catch (err: any) {
      setError(err.message || '删除知识库失败');
    } finally {
      setDeletingId('');
    }
  };

  const toggleChunks = async (document: KnowledgeDocument) => {
    if (!targetId) return;

    if (expandedDocumentId === document.id) {
      setExpandedDocumentId('');
      return;
    }

    setExpandedDocumentId(document.id);
    if (chunksByDocumentId[document.id]) return;

    setLoadingChunksId(document.id);
    setError('');
    try {
      const result = isSpace
        ? await spaces.knowledgeChunks(targetId, document.id)
        : await agents.knowledgeChunks(targetId, document.id);
      setChunksByDocumentId((current) => ({ ...current, [document.id]: result.chunks }));
    } catch (err: any) {
      setError(err.message || '加载片段失败');
    } finally {
      setLoadingChunksId('');
    }
  };

  const searchKnowledge = async () => {
    if (!targetId || !searchQuery.trim() || searching) return;

    setSearching(true);
    setHasSearched(true);
    setError('');
    setNotice('');
    try {
      const result = isSpace
        ? await spaces.searchKnowledge(targetId, searchQuery.trim())
        : await agents.searchKnowledge(targetId, searchQuery.trim());
      setSearchHits(result.hits);
    } catch (err: any) {
      setError(err.message || '测试检索失败');
    } finally {
      setSearching(false);
    }
  };

  if (!targetId) {
    return (
      <section className="rounded-[28px] border border-dashed border-slate-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fbfaf7] text-slate-400">
          <Database size={22} />
        </div>
        <h2 className="text-xl font-black text-slate-950">暂未选定目标</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
          知识库需要绑定到具体 Agent 或空间。创建成功后即可上传 .txt / .md 并自动按 Markdown 章节分块建立向量。
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[28px] border border-black/[0.06] bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-sm">
            <Database size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black text-slate-950">
                {isSpace ? '空间公共知识库' : '角色知识库维护'}
              </h2>
              {isSpace && (
                <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-800">
                  全员共享
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500">
              {targetTitle} 的文档切片与章节向量索引。
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label
            className={cn(
              'inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg',
              uploading && 'cursor-default bg-slate-200 text-slate-400 hover:translate-y-0 hover:shadow-sm'
            )}
          >
            {uploading ? <Loader2 className="animate-spin" size={16} /> : <UploadCloud size={16} />}
            上传文档
            <input
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              className="hidden"
              disabled={uploading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                uploadKnowledge(file);
              }}
            />
          </label>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-black/[0.08] bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-950"
              title="关闭"
            >
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      <div className="mb-5 flex flex-col gap-2 rounded-2xl bg-[#fbfaf7] p-4 text-xs leading-5 text-slate-600 sm:text-sm">
        <div className="flex items-center gap-1.5 font-bold text-slate-800">
          <Bookmark size={15} className="text-sky-600" />
          <span>Markdown 章节感知特性：</span>
        </div>
        <p className="text-slate-500">
          支持上传 <strong>.md</strong> 或 <strong>.txt</strong> 文档。系统会自动解析文档的一级至六级标题（<code># / ## / ###</code>），构建多层级章节面包屑并在分块时注入语义向量。在对话或多人接力时，AI 能准确掌握切片的章节上下文！
        </p>
      </div>

      <div className="mb-5 rounded-2xl border border-black/[0.06] bg-white p-4 shadow-2xs">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(event) => {
                const val = event.target.value;
                setSearchQuery(val);
                if (!val.trim()) {
                  clearSearch();
                }
              }}
              onKeyDown={(event) => event.key === 'Enter' && searchKnowledge()}
              placeholder="输入测试问题，按 Enter 检索相关切片..."
              className="h-11 w-full rounded-2xl border border-black/[0.08] bg-[#fbfaf7] pl-10 pr-10 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition"
                title="清空搜索"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={searchKnowledge}
              disabled={!searchQuery.trim() || searching}
              className="inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-400 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
            >
              {searching ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
              {searching ? '检索中...' : '测试检索'}
            </button>
            {hasSearched && (
              <button
                type="button"
                onClick={clearSearch}
                className="inline-flex h-11 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-black/[0.08] bg-white px-4 text-xs font-bold text-slate-600 shadow-2xs hover:bg-slate-50 hover:text-slate-950 transition"
                title="清空搜索结果并返回文档列表"
              >
                <X size={14} />
                清空搜索
              </button>
            )}
          </div>
        </div>
      </div>

      {error && <div className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{error}</div>}
      {notice && <div className="mb-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div>}

      {hasSearched ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-black text-slate-950">语义检索测试结果</span>
              <span className="rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-bold text-sky-800">
                共 {searchHits.length} 个切片
              </span>
            </div>
            <button
              type="button"
              onClick={clearSearch}
              className="cursor-pointer text-xs font-bold text-sky-600 hover:text-sky-700 hover:underline flex items-center gap-1"
            >
              返回全部文档 ({documents.length})
            </button>
          </div>

          {searching ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-black/[0.06] bg-[#fbfaf7] py-14 text-slate-400">
              <Loader2 className="animate-spin mb-3 text-slate-600" size={24} />
              <div className="text-sm font-semibold text-slate-700">正在检索知识向量库...</div>
              <div className="mt-1 text-xs text-slate-400">通过 BGE 模型计算语义余弦相似度匹配度</div>
            </div>
          ) : searchHits.length > 0 ? (
            <div className="space-y-3">
              {searchHits.map((hit) => (
                <div key={hit.id} className="rounded-2xl border border-black/[0.06] bg-[#fbfaf7] p-4 transition hover:border-black/15 shadow-2xs">
                  <div className="mb-2.5 flex flex-wrap items-center gap-2 text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => {
                        const targetDoc = documents.find((d) => d.id === hit.documentId);
                        if (targetDoc) {
                          viewFullDocument(targetDoc);
                        } else {
                          viewFullDocument({ id: hit.documentId, fileName: hit.fileName } as any);
                        }
                      }}
                      className="group flex items-center gap-1.5 font-bold text-slate-800 hover:text-sky-600 cursor-pointer"
                      title="点击查看完整原文档"
                    >
                      <FileText size={14} className="text-slate-400 group-hover:text-sky-600 transition" />
                      <span className="group-hover:underline">{hit.fileName}</span>
                    </button>
                    {hit.title && (
                      <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-800">
                        章节: {hit.title}
                      </span>
                    )}
                    <span className="text-slate-400">切片 #{hit.chunkIndex + 1}</span>
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-bold text-emerald-800">
                      相关度: {(hit.score * 100).toFixed(1)}%
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700 bg-white p-3.5 rounded-xl border border-black/[0.04] select-text">
                    {hit.content}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-[#fbfaf7] p-10 text-center">
              <Search className="mx-auto text-slate-300" size={28} />
              <h3 className="mt-4 text-base font-black text-slate-950">未召回相关切片</h3>
              <p className="mt-2 text-sm text-slate-500">
                未能匹配到相似度高于阈值的文档切片，可尝试调整提问词或短语。
              </p>
              <button
                type="button"
                onClick={clearSearch}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-slate-950 px-4 py-2 text-xs font-bold text-white transition hover:bg-slate-800 cursor-pointer shadow-sm"
              >
                返回全部文档
              </button>
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="mb-3 flex items-center justify-between px-1">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              全部知识文档 ({documents.length})
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center rounded-2xl border border-black/[0.06] bg-[#fbfaf7] py-14 text-slate-400">
              <Loader2 className="animate-spin" size={22} />
            </div>
          ) : documents.length > 0 ? (
            <div className="space-y-3">
              {documents.map((document) => {
                const isDeleting = deletingId === document.id;
                const isExpanded = expandedDocumentId === document.id;
                const chunks = chunksByDocumentId[document.id] || [];
                const isLoadingChunks = loadingChunksId === document.id;
                return (
                  <div key={document.id} className="flex flex-col gap-3 rounded-2xl border border-black/[0.06] bg-[#fbfaf7] p-4 sm:flex-row sm:flex-wrap sm:items-center">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-white text-slate-600 shadow-sm">
                      <FileText size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => viewFullDocument(document)}
                        disabled={loadingRawId === document.id}
                        className="group flex max-w-full items-center gap-2 text-left transition hover:text-sky-600 cursor-pointer"
                        title="点击查看完整文档"
                      >
                        <span className="truncate text-sm font-black text-slate-950 group-hover:text-sky-600 group-hover:underline">
                          {document.fileName}
                        </span>
                        {loadingRawId === document.id ? (
                          <Loader2 className="animate-spin text-sky-600 shrink-0" size={13} />
                        ) : (
                          <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-400 transition group-hover:bg-sky-50 group-hover:text-sky-600">
                            查看
                          </span>
                        )}
                      </button>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-slate-400">
                        <span>{formatBytes(document.size)}</span>
                        <span className="font-bold text-slate-700">{document._count?.chunks || 0} 个切片</span>
                        <span>{formatDate(document.createdAt)}</span>
                        {document.sourceType === 'STUDY' ? <span className="text-emerald-600 font-bold">自主研习</span> : null}
                        {document.status === 'DRAFT' ? <span className="text-amber-600">草稿 · 未参与检索</span> : null}
                      </div>
                      {document.summary && (
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600 bg-white/70 rounded-xl px-3 py-1.5 border border-black/[0.04]">
                          <span className="font-bold text-slate-800">核心摘要：</span>{document.summary}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleChunks(document)}
                        className="inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-black/[0.06] bg-white px-3.5 text-xs font-bold text-slate-600 shadow-sm transition hover:text-slate-950"
                        title="展开/收起切片明细"
                      >
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {isExpanded ? '收起切片' : '切片明细'}
                      </button>

                      <button
                        type="button"
                        onClick={() => deleteDocument(document)}
                        disabled={Boolean(deletingId)}
                        className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-rose-100 bg-rose-50 text-rose-500 shadow-sm transition hover:bg-rose-100 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-300"
                        title="删除文档"
                        aria-label="删除文档"
                      >
                        {isDeleting ? <Loader2 className="animate-spin" size={15} /> : <Trash2 size={15} />}
                      </button>
                    </div>
                    {isExpanded && (
                      <div className="w-full rounded-2xl bg-white p-4 shadow-2xs">
                        {isLoadingChunks ? (
                          <div className="flex items-center justify-center py-8 text-slate-400">
                            <Loader2 className="animate-spin" size={20} />
                          </div>
                        ) : chunks.length > 0 ? (
                          <div className="space-y-3">
                            <div className="flex items-center justify-between text-xs font-bold text-slate-500 pb-1 border-b border-slate-100">
                              <span>包含 {chunks.length} 个结构化语义切片</span>
                              <span className="text-[11px] font-normal text-slate-400">完整段落 · 句子边界保护 · BGE 512-Token 适配</span>
                            </div>
                            {chunks.map((chunk) => (
                              <div key={chunk.id} className="rounded-2xl border border-black/[0.04] bg-[#fbfaf7] p-4">
                                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-black text-slate-400">
                                  <span>切片 #{chunk.chunkIndex + 1}</span>
                                  {chunk.title && (
                                    <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-800">
                                      章节: {chunk.title}
                                    </span>
                                  )}
                                </div>
                                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{chunk.content}</p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-2xl bg-[#fbfaf7] px-4 py-6 text-center text-sm font-semibold text-slate-400">
                            该文档暂无切片。
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-[#fbfaf7] p-10 text-center">
              <FileText className="mx-auto text-slate-300" size={28} />
              <h3 className="mt-4 text-base font-black text-slate-950">还没有知识库文档</h3>
              <p className="mt-2 text-sm text-slate-500">
                上传文档后，系统将自动识别 Markdown 章节并建立高维向量，在对话和讨论中提供专业背景支持。
              </p>
            </div>
          )}
        </div>
      )}

      {viewingDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 sm:p-6 animate-in fade-in duration-200">
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-3xl bg-white shadow-2xl border border-black/[0.08] overflow-hidden">
            <div className="flex items-center justify-between border-b border-black/[0.06] px-6 py-4 bg-[#fbfaf7]">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                  <FileText size={17} />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-base font-black text-slate-950">{viewingDoc.fileName}</div>
                  <div className="text-xs text-slate-400">完整原始文档 · 格式化预览</div>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(viewingDoc.content);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-black/[0.06] bg-white text-slate-600 hover:text-slate-950 transition shadow-2xs"
                  title={copied ? '已复制全文' : '复制全文'}
                  aria-label="复制全文"
                >
                  {copied ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    downloadKnowledgeFile(targetId, viewingDoc.id, viewingDoc.fileName, isSpace);
                  }}
                  className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-black/[0.06] bg-white text-slate-600 hover:text-slate-950 transition shadow-2xs"
                  title="下载原文件 (.md)"
                  aria-label="下载原文件"
                >
                  <Download size={15} />
                </button>

                <button
                  type="button"
                  onClick={() => setViewingDoc(null)}
                  className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-black/[0.06] bg-white text-slate-400 hover:text-slate-950 transition"
                  title="关闭"
                  aria-label="关闭"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-[#fbfaf7]/40">
              <div className="markdown-body p-6 text-sm leading-7 text-slate-800 bg-white rounded-2xl border border-black/[0.04] shadow-2xs select-text overflow-x-auto">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {viewingDoc.content}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
