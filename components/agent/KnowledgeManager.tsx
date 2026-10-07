'use client';

import { useEffect, useState } from 'react';
import { Bookmark, ChevronDown, ChevronRight, Database, FileText, Loader2, Search, Trash2, UploadCloud, X } from 'lucide-react';
import { agents, spaces } from '@/lib/api';
import { cn } from '@/lib/utils';

type KnowledgeDocument = {
  id: string;
  fileName: string;
  size?: number | null;
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
    setHasSearched(false);
    setError('');
    setNotice('');
    try {
      const result = isSpace
        ? await spaces.searchKnowledge(targetId, searchQuery.trim())
        : await agents.searchKnowledge(targetId, searchQuery.trim());
      setSearchHits(result.hits);
      setHasSearched(true);
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
        <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-950">
          <Search size={16} />
          测试语义检索
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && searchKnowledge()}
            placeholder="输入一个测试问题，查看召回的切片和章节背景..."
            className="h-11 min-w-0 flex-1 rounded-2xl border border-black/[0.08] bg-[#fbfaf7] px-4 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70"
          />
          <button
            onClick={searchKnowledge}
            disabled={!searchQuery.trim() || searching}
            className="inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-slate-950 px-5 text-sm font-black text-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-400 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
          >
            {searching ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
            {searching ? '语义检索中' : '检索测试'}
          </button>
        </div>
        {searching && (
          <div className="mt-3 text-xs font-semibold text-slate-400">
            正在通过 BGE 中文向量模型进行余弦相似度匹配计算...
          </div>
        )}
        {searchHits.length > 0 && (
          <div className="mt-4 space-y-3">
            {searchHits.map((hit) => (
              <div key={hit.id} className="rounded-2xl border border-black/[0.04] bg-[#fbfaf7] p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-black text-slate-400">
                  <span className="text-slate-700">{hit.fileName}</span>
                  {hit.title && (
                    <span className="rounded-md bg-sky-100 px-2 py-0.5 text-[11px] font-bold text-sky-800">
                      章节: {hit.title}
                    </span>
                  )}
                  <span>切片 #{hit.chunkIndex + 1}</span>
                  <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800">
                    相关度: {(hit.score * 100).toFixed(1)}%
                  </span>
                </div>
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{hit.content}</p>
              </div>
            ))}
          </div>
        )}
        {hasSearched && searchHits.length === 0 && !searching && (
          <div className="mt-4 rounded-2xl bg-[#fbfaf7] px-4 py-6 text-center text-sm font-semibold text-slate-400">
            未召回相关切片（可尝试调整问题用词）。
          </div>
        )}
      </div>

      {error && <div className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{error}</div>}
      {notice && <div className="mb-4 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div>}

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
                  <div className="truncate text-sm font-black text-slate-950">{document.fileName}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-slate-400">
                    <span>{formatBytes(document.size)}</span>
                    <span>{document._count?.chunks || 0} 个切片</span>
                    <span>{formatDate(document.createdAt)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleChunks(document)}
                  className="inline-flex h-10 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-black/[0.06] bg-white px-3 text-sm font-bold text-slate-600 shadow-sm transition hover:text-slate-950"
                >
                  {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  {isExpanded ? '收起切片' : '查看切片与章节'}
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
                {isExpanded && (
                  <div className="w-full rounded-2xl bg-white p-4 shadow-2xs">
                    {isLoadingChunks ? (
                      <div className="flex items-center justify-center py-8 text-slate-400">
                        <Loader2 className="animate-spin" size={20} />
                      </div>
                    ) : chunks.length > 0 ? (
                      <div className="space-y-3">
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
    </section>
  );
}
