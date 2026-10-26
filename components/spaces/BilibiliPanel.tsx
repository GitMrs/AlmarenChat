'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft, Check, ExternalLink, Heart, Loader2, LogOut, Play, RefreshCw, Star, Coins,
  Tv, Unplug, X, QrCode as QrCodeIcon, ShieldCheck, AlertCircle, Search, Flame, Copy, Sparkles, Save,
  HelpCircle,
} from 'lucide-react';
import {
  spaces as spacesApi,
  type BilibiliFolder,
  type BilibiliHotItem,
  type BilibiliProfile,
  type BilibiliVideoItem,
  type BilibiliVideoResponse,
} from '@/lib/client/api';
import { createClientId } from '@/lib/client/client-id';
import type { SpaceActionRequest, SpaceConnector } from '@/types';
import BilibiliDiscoveryCard from './BilibiliDiscoveryCard';

type Tab = 'history' | 'likes' | 'favorites' | 'videos' | 'hot';
type ActionKind = 'BILIBILI_LIKE' | 'BILIBILI_COIN' | 'BILIBILI_FAVORITE';
type VideoListContext = 'likes' | 'favorites' | 'default';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'history', label: '最近看过' },
  { id: 'likes', label: '我点赞的' },
  { id: 'favorites', label: '收藏夹' },
  { id: 'videos', label: '我的稿件' },
  { id: 'hot', label: 'B站热门' },
];

const ACTION_LABEL: Record<ActionKind, string> = {
  BILIBILI_LIKE: '点赞',
  BILIBILI_COIN: '投币',
  BILIBILI_FAVORITE: '收藏',
};

function formatDuration(seconds: number) {
  const total = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatCount(value: number) {
  const n = Number(value) || 0;
  if (n >= 100000000) return `${(n / 100000000).toFixed(1)} 亿`;
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`;
  return String(n);
}

function formatDate(timestamp: number) {
  if (!timestamp) return '';
  return new Date(timestamp * 1000).toLocaleDateString('zh-CN');
}

function normalizeImage(url?: string) {
  const value = String(url || '').trim();
  if (!value) return '';
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('http://')) return `https://${value.slice(7)}`;
  return value;
}

function hotToItem(item: BilibiliHotItem): BilibiliVideoItem | null {
  const match = String(item.url || '').match(/\/video\/(BV[0-9A-Za-z]{10})/);
  if (!match) return null;
  const published = item.publishTime ? Math.floor(new Date(item.publishTime).getTime() / 1000) : 0;
  return {
    bvid: match[1],
    title: item.title,
    cover: normalizeImage(item.thumbnail),
    author: String(item.extra?.owner || ''),
    mid: '',
    duration: 0,
    play: Number(item.extra?.view || 0),
    pubdate: Number.isFinite(published) ? published : 0,
    url: item.url,
    desc: item.desc || '',
  };
}

function emptyTextForTab(tab: Tab) {
  switch (tab) {
    case 'history':
      return '还没有观看记录。可以先从「B站热门」挑一条，或直接搜索；刷新后这里会显示最近看过的视频。';
    case 'likes':
      return '最近没有点赞记录。B 站只提供最近约 20 条点赞，可以先从「B站热门」看看。';
    case 'favorites':
      return '这个收藏夹是空的。';
    case 'videos':
      return '还没有读到你的稿件。';
    default:
      return '这里还是空的。换一个 Tab，或点右上角刷新。';
  }
}

export default function BilibiliPanel({
  spaceId,
  onBackToChat,
  onSendMessage,
}: {
  spaceId: string;
  onBackToChat: () => void;
  onSendMessage?: (text: string) => void;
}) {
  const [connector, setConnector] = useState<SpaceConnector | null>(null);
  const [profile, setProfile] = useState<BilibiliProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [qr, setQr] = useState<{ url: string; key: string } | null>(null);
  const [qrImage, setQrImage] = useState('');
  const [qrStatus, setQrStatus] = useState<'waiting' | 'scanned' | 'expired'>('waiting');
  const [showCookie, setShowCookie] = useState(false);
  const [cookieInput, setCookieInput] = useState('');

  const [tab, setTab] = useState<Tab>('history');
  const [items, setItems] = useState<BilibiliVideoItem[]>([]);
  const [folders, setFolders] = useState<BilibiliFolder[]>([]);
  const [activeFolder, setActiveFolder] = useState<string>('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [dataLoading, setDataLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [cached, setCached] = useState(false);

  const [hotItems, setHotItems] = useState<BilibiliVideoItem[]>([]);
  const [hotLoading, setHotLoading] = useState(false);

  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BilibiliVideoItem[] | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  const [detail, setDetail] = useState<{ bvid: string; loading: boolean; source: VideoListContext; data?: BilibiliVideoResponse; error?: string } | null>(null);

  const [pending, setPending] = useState<SpaceActionRequest[]>([]);
  const [intent, setIntent] = useState<{ kind: ActionKind; item: BilibiliVideoItem; mediaId?: string } | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const connected = Boolean(connector?.configured && connector.enabled);

  const loadConnector = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await spacesApi.bilibiliConnector(spaceId);
      setConnector(result.connector);
      if (result.connector?.configured) {
        try {
          const data = await spacesApi.bilibiliData(spaceId, { tab: 'profile' });
          if (data?.profile) setProfile(data.profile);
        } catch (profileError: any) {
          if (profileError?.status === 409) {
            setError(profileError.message || 'B 站登录已失效，请重新扫码');
          }
        }
      }
    } catch (err: any) {
      setError(err?.message || '读取连接状态失败');
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  const loadActions = useCallback(async () => {
    try {
      const result = await spacesApi.actions(spaceId);
      setPending((result.actions || []).filter((action) => action.status === 'PENDING' && action.kind.startsWith('BILIBILI_')));
    } catch {
      // 审批列表失败不阻塞主流程
    }
  }, [spaceId]);

  const loadData = useCallback(async (options: { tab: Exclude<Tab, 'hot'>; page?: number; mediaId?: string; refresh?: boolean; append?: boolean }) => {
    setDataLoading(true);
    setError('');
    try {
      const result = await spacesApi.bilibiliData(spaceId, {
        tab: options.tab,
        page: options.page || 1,
        mediaId: options.mediaId,
        refresh: options.refresh,
      });
      setItems((prev) => (options.append ? [...prev, ...(result.items || [])] : (result.items || [])));
      if (result.folders) setFolders(result.folders);
      setHasMore(Boolean(result.hasMore));
      setFetchedAt(result.fetchedAt || 0);
      setCached(Boolean(result.cached));
    } catch (err: any) {
      setError(err?.message || '读取 B 站数据失败');
      if (!options.append) setItems([]);
    } finally {
      setDataLoading(false);
    }
  }, [spaceId]);

  const loadFolders = useCallback(async () => {
    try {
      const result = await spacesApi.bilibiliData(spaceId, { tab: 'favorites' });
      setFolders(result.folders || []);
    } catch {
      // 收藏夹读取失败不阻塞其他 Tab
    }
  }, [spaceId]);

  const loadHot = useCallback(async () => {
    setHotLoading(true);
    setError('');
    try {
      const result = await spacesApi.bilibiliHot(20);
      const mapped = (result.items || []).map(hotToItem).filter(Boolean) as BilibiliVideoItem[];
      setHotItems(mapped);
    } catch (err: any) {
      setError(err?.message || '读取 B 站热门失败');
    } finally {
      setHotLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConnector();
    void loadActions();
  }, [loadConnector, loadActions]);

  useEffect(() => {
    if (!connected || tab === 'hot') return;
    setPage(1);
    setActiveFolder('');
    void loadData({ tab });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, tab]);

  useEffect(() => {
    if (!connected) return;
    void loadFolders();
  }, [connected, loadFolders]);

  useEffect(() => {
    if (tab === 'hot' && hotItems.length === 0) void loadHot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => {
    if (!qr) {
      setQrImage('');
      return;
    }
    let cancelled = false;
    import('qrcode')
      .then((mod: any) => {
        const lib = typeof mod?.toDataURL === 'function' ? mod : mod?.default;
        return lib.toDataURL(qr.url, { width: 240, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } });
      })
      .then((url: string) => { if (!cancelled) setQrImage(url); })
      .catch(() => { if (!cancelled) setQrImage(''); });
    return () => { cancelled = true; };
  }, [qr]);

  useEffect(() => {
    if (!qr) return;
    let stopped = false;
    setQrStatus('waiting');
    const timer = setInterval(async () => {
      try {
        const result = await spacesApi.pollBilibiliQrCode(spaceId, qr.key);
        if (stopped) return;
        if (result.status === 'scanned') setQrStatus('scanned');
        if (result.status === 'expired') {
          setQr(null);
          setError('二维码已过期，请重新生成');
        }
        if (result.status === 'success') {
          setQr(null);
          setConnector(result.connector || null);
          if (result.profile) setProfile(result.profile);
          if (result.warning) {
            setError(`B 站账号已连接，但资料读取失败：${result.warning}`);
          } else {
            setNotice('B 站账号已连接');
          }
        }
      } catch (error: any) {
        if (stopped) return;
        // 轮询偶发失败保持安静；服务端 5xx 时停止轮询并提示，避免登录成功却一直无反馈。
        if (error?.status >= 500) {
          setQr(null);
          setError(error.message || '扫码状态查询失败，请重试或改用粘贴 Cookie');
        }
      }
    }, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [qr, spaceId]);

  const startQr = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await spacesApi.createBilibiliQrCode(spaceId);
      setQr(result);
    } catch (err: any) {
      setError(err?.message || '生成二维码失败');
    } finally {
      setBusy(false);
    }
  };

  const saveCookie = async () => {
    if (!cookieInput.trim()) return;
    setBusy(true);
    setError('');
    try {
      const result = await spacesApi.connectBilibiliCookie(spaceId, cookieInput.trim());
      setConnector(result.connector);
      setProfile(result.profile);
      setCookieInput('');
      setShowCookie(false);
      setNotice('B 站账号已连接');
    } catch (err: any) {
      setError(err?.message || '保存 Cookie 失败');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm('断开后需要重新扫码才能继续使用，确定断开吗？')) return;
    setBusy(true);
    try {
      await spacesApi.removeBilibiliConnector(spaceId);
      setConnector(null);
      setProfile(null);
      setItems([]);
      setFolders([]);
      setNotice('');
    } catch (err: any) {
      setError(err?.message || '断开连接失败');
    } finally {
      setBusy(false);
    }
  };

  const validate = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await spacesApi.validateBilibiliConnector(spaceId);
      setConnector(result.connector);
      setProfile(result.profile);
      setNotice('连接正常');
    } catch (err: any) {
      setError(err?.message || '校验失败');
    } finally {
      setBusy(false);
    }
  };

  const refreshCurrent = async () => {
    if (tab === 'hot') {
      await loadHot();
      return;
    }
    await loadData({ tab, page: 1, mediaId: activeFolder || undefined, refresh: true });
  };

  const openFolder = async (folder: BilibiliFolder) => {
    setActiveFolder(folder.id);
    setPage(1);
    await loadData({ tab: 'favorites', mediaId: folder.id });
  };

  const loadMore = async () => {
    const next = page + 1;
    setPage(next);
    await loadData({ tab: tab === 'hot' ? 'history' : tab, page: next, mediaId: activeFolder || undefined, append: true });
  };

  const runSearch = async () => {
    const value = query.trim();
    if (!value) return;
    setSearchLoading(true);
    setError('');
    try {
      const result = await spacesApi.searchBilibili(spaceId, value);
      setSearchResults(result.items || []);
      setSearchQuery(value);
    } catch (err: any) {
      setError(err?.message || '搜索失败');
      setSearchResults([]);
      setSearchQuery(value);
    } finally {
      setSearchLoading(false);
    }
  };

  const clearSearch = () => {
    setSearchResults(null);
    setSearchQuery('');
    setQuery('');
  };

  const openDetail = async (bvid: string, source: VideoListContext = 'default') => {
    setNotice('');
    setError('');
    setDetail({ bvid, loading: true, source });
    try {
      const data = await spacesApi.bilibiliVideo(spaceId, bvid);
      setDetail({ bvid, loading: false, source, data });
    } catch (err: any) {
      setDetail({ bvid, loading: false, source, error: err?.message || '解析视频失败' });
    }
  };

  const copyDetail = async () => {
    const text = detail?.data?.formatted || '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setNotice('已复制视频全文');
    } catch {
      setError('复制失败，请手动选择文本');
    }
  };

  const saveToSpace = async () => {
    const data = detail?.data;
    if (!data?.video) return;
    setBusy(true);
    setError('');
    try {
      const safeTitle = data.video.title.replace(/[\\/:*?"<>|\n\r]/g, '_').trim().slice(0, 60) || data.video.bvid;
      const body = `${data.formatted}\n\n---\n原视频：${data.video.url}\n`;
      const file = new File([body], `${data.video.bvid}-${safeTitle}.md`, { type: 'text/markdown' });
      await spacesApi.uploadFile(spaceId, file, { role: 'SHARED' });
      setNotice('已存到空间资料（shared），Agent 可以直接读取');
    } catch (err: any) {
      setError(err?.message || '存入空间失败');
    } finally {
      setBusy(false);
    }
  };

  const sendToAgent = () => {
    const data = detail?.data;
    if (!data?.video || !onSendMessage) return;
    const video = data.video;
    const excerpt = (video.subtitleText || '').slice(0, 4000);
    const parts = [
      `我想拆解这条 B 站视频：${video.url}`,
      `标题：${video.title}`,
      video.author ? `UP主：${video.author}` : '',
      video.desc ? `简介：${video.desc.slice(0, 800)}` : '',
      excerpt
        ? `字幕节选（前 4000 字）：\n${excerpt}`
        : '（这条视频没有可用字幕，请只基于标题、简介和你的判断分析，不要编造视频内容；如确需逐字稿，请先说明 ASR 可能耗时数分钟并询问我是否继续，得到确认后再调用 bilibili_video 的 transcribe=true + confirmed=true。）',
      '请从观众视角拆解：它为什么好看或不好看、开头钩子是什么、结构如何、有没有我能复用的选题或表达。',
    ].filter(Boolean);
    onSendMessage(parts.join('\n\n'));
  };

  const submitAction = async () => {
    if (!intent) return;
    if (intent.kind === 'BILIBILI_FAVORITE' && !intent.mediaId) {
      setError('请先选择收藏夹');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await spacesApi.requestBilibiliAction(spaceId, {
        kind: intent.kind,
        bvid: intent.item.bvid,
        title: intent.item.title,
        mediaId: intent.mediaId,
        count: 1,
        requestId: createClientId(),
      });
      setNotice(`已提交${ACTION_LABEL[intent.kind]}审批，确认后才会执行`);
      setIntent(null);
      await loadActions();
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      setError(err?.message || '提交动作失败');
    } finally {
      setBusy(false);
    }
  };

  const decide = async (action: SpaceActionRequest, decision: 'approve' | 'reject') => {
    setBusy(true);
    try {
      await spacesApi.decideAction(spaceId, action.id, decision);
      await loadActions();
      if (decision === 'approve') {
        setNotice(`已${ACTION_LABEL[action.kind as ActionKind] || '执行'}`);
        if (tab !== 'hot') {
          await loadData({ tab, page, mediaId: activeFolder || undefined, refresh: true });
        }
      }
    } catch (err: any) {
      setError(err?.message || '处理失败');
    } finally {
      setBusy(false);
    }
  };

  const pendingFor = useMemo(() => {
    const map = new Map<string, SpaceActionRequest>();
    for (const action of pending) {
      const bvid = (action.payload as any)?.bvid;
      if (bvid) map.set(`${action.kind}:${bvid}`, action);
    }
    return map;
  }, [pending]);

  const favoriteFolders = useMemo(() => folders.filter((folder) => folder.id), [folders]);

  // 点赞/收藏列表里的条目已经处于对应状态，不再展示重复的写操作入口。
  const renderVideoList = (list: BilibiliVideoItem[], emptyText: string, context: VideoListContext = 'default') => (
    <div className="space-y-3">
      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-black/[0.08] bg-white p-10 text-center text-xs font-semibold text-slate-400">
          {emptyText}
        </div>
      ) : null}
      {list.map((item) => (
        <article key={item.bvid} className="flex gap-3 rounded-2xl border border-black/[0.06] bg-white p-3 transition hover:border-slate-200">
          <button
            type="button"
            onClick={() => void openDetail(item.bvid, context)}
            className="relative block h-[74px] w-[132px] shrink-0 overflow-hidden rounded-xl bg-slate-100"
          >
            {item.cover ? (
              <img src={normalizeImage(item.cover)} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" loading="lazy" />
            ) : null}
            {item.duration > 0 ? (
              <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-0.5 text-[10px] font-bold text-white">{formatDuration(item.duration)}</span>
            ) : null}
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <button
                type="button"
                onClick={() => void openDetail(item.bvid, context)}
                className="line-clamp-2 flex-1 text-left text-sm font-black leading-5 text-slate-900 hover:underline"
              >
                {item.title}
              </button>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                title="在 B 站打开"
                className="mt-0.5 shrink-0 text-slate-300 transition hover:text-slate-700"
              >
                <ExternalLink size={13} />
              </a>
            </div>
            <div className="mt-1 flex flex-wrap gap-3 text-[11px] font-semibold text-slate-400">
              <span className="inline-flex items-center gap-1"><Play size={11} /> {formatCount(item.play)}</span>
              {item.author ? <span className="truncate">UP：{item.author}</span> : null}
              {item.pubdate ? <span>{formatDate(item.pubdate)}</span> : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {context !== 'likes' ? (
                <ActionButton
                  icon={<Heart size={12} />}
                  label="点赞"
                  disabled={busy || pendingFor.has(`BILIBILI_LIKE:${item.bvid}`)}
                  pending={pendingFor.has(`BILIBILI_LIKE:${item.bvid}`)}
                  onClick={() => setIntent({ kind: 'BILIBILI_LIKE', item })}
                />
              ) : null}
              <ActionButton
                icon={<Coins size={12} />}
                label="投币"
                disabled={busy || pendingFor.has(`BILIBILI_COIN:${item.bvid}`)}
                pending={pendingFor.has(`BILIBILI_COIN:${item.bvid}`)}
                onClick={() => setIntent({ kind: 'BILIBILI_COIN', item })}
              />
              {context !== 'favorites' ? (
                <ActionButton
                  icon={<Star size={12} />}
                  label="收藏"
                  disabled={busy || pendingFor.has(`BILIBILI_FAVORITE:${item.bvid}`)}
                  pending={pendingFor.has(`BILIBILI_FAVORITE:${item.bvid}`)}
                  onClick={() => setIntent({ kind: 'BILIBILI_FAVORITE', item, mediaId: favoriteFolders[0]?.id })}
                />
              ) : null}
            </div>
          </div>
        </article>
      ))}
    </div>
  );

  if (loading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-[#fbfaf7]">
        <Loader2 className="animate-spin text-slate-300" size={22} />
      </div>
    );
  }

  const detailVideo = detail?.data?.video;

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto bg-[#fbfaf7]">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/[0.07] pb-5">
          <div>
            <button
              type="button"
              onClick={onBackToChat}
              className="mb-2 inline-flex items-center gap-1 text-xs font-bold text-slate-400 transition hover:text-slate-900"
            >
              <ArrowLeft size={14} /> 返回对话
            </button>
            <h2 className="flex items-center gap-2 text-xl font-black text-slate-950">
              <Tv size={20} /> B 站
            </h2>
            <p className="mt-1 text-xs font-semibold text-slate-400">
              看自己刷过什么、喜欢什么；也可以让发现机器人主动找好玩的。所有点赞、投币、收藏都要你确认。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowGuide(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/[0.08] bg-white px-3 text-xs font-black text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
            >
              <HelpCircle size={14} /> 怎么用
            </button>
            {connected && (
              <>
                <button
                  type="button"
                  onClick={() => void refreshCurrent()}
                  disabled={dataLoading || hotLoading}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/[0.08] bg-white px-3 text-xs font-black text-slate-700 transition hover:border-slate-300 disabled:opacity-50"
                >
                  <RefreshCw size={14} className={dataLoading || hotLoading ? 'animate-spin' : ''} /> 刷新
                </button>
                <button
                  type="button"
                  onClick={() => void validate()}
                  disabled={busy}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/[0.08] bg-white px-3 text-xs font-black text-slate-700 transition hover:border-slate-300 disabled:opacity-50"
                >
                  <ShieldCheck size={14} /> 校验
                </button>
                <button
                  type="button"
                  onClick={() => void disconnect()}
                  disabled={busy}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/[0.08] bg-white px-3 text-xs font-black text-slate-500 transition hover:border-rose-200 hover:text-rose-600 disabled:opacity-50"
                >
                  <LogOut size={14} /> 断开
                </button>
              </>
            )}
          </div>
        </header>

        {(error || notice) && (
          <div className={`mt-4 flex items-start gap-2 rounded-xl px-4 py-3 text-sm font-semibold ${error ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'}`}>
            {error ? <AlertCircle size={16} className="mt-0.5 shrink-0" /> : <Check size={16} className="mt-0.5 shrink-0" />}
            <span className="flex-1">{error || notice}</span>
            <button type="button" onClick={() => { setError(''); setNotice(''); }} className="opacity-60 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        )}

        {!connected ? (
          <>
            <div className="mt-6 rounded-2xl border border-black/[0.06] bg-white px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] font-bold text-slate-500">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-950 text-[10px] font-black text-white">1</span>
                连接账号
                <span className="text-slate-300">→</span>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black text-slate-500">2</span>
                看历史 / 热门 / 搜索
                <span className="text-slate-300">→</span>
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black text-slate-500">3</span>
                拆解视频或提交互动审批
                <button
                  type="button"
                  onClick={() => setShowGuide(true)}
                  className="ml-auto inline-flex items-center gap-1 text-[11px] font-black text-slate-900 hover:underline"
                >
                  <HelpCircle size={12} /> 详细说明
                </button>
              </div>
            </div>
            <div className="mt-4 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
            <section className="rounded-2xl border border-black/[0.06] bg-white p-6">
              <h3 className="text-sm font-black text-slate-950">连接你的 B 站账号</h3>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">
                扫码后只读取你的观看历史、点赞、收藏和稿件。Cookie 只存在服务端，前端不会回显。
              </p>
              <div className="mt-5 flex flex-col items-center justify-center rounded-2xl border border-dashed border-black/[0.08] bg-[#fbfaf7] p-6">
                {qr ? (
                  <>
                    {qrImage ? <img src={qrImage} alt="B 站登录二维码" className="h-56 w-56 rounded-xl bg-white" /> : <Loader2 className="animate-spin text-slate-300" size={24} />}
                    <div className="mt-3 text-xs font-bold text-slate-500">
                      {qrStatus === 'scanned' ? '已扫码，请在手机上确认' : '用 B 站 App 扫码登录'}
                    </div>
                    <button
                      type="button"
                      onClick={() => setQr(null)}
                      className="mt-2 text-[11px] font-bold text-slate-400 underline-offset-2 hover:underline"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <QrCodeIcon size={40} className="text-slate-300" />
                    <button
                      type="button"
                      onClick={() => void startQr()}
                      disabled={busy}
                      className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50"
                    >
                      {busy ? <Loader2 size={16} className="animate-spin" /> : <QrCodeIcon size={16} />} 生成二维码
                    </button>
                  </>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-black/[0.06] bg-white p-6">
              <h3 className="text-sm font-black text-slate-950">扫码不成功？</h3>
              <p className="mt-1 text-xs font-semibold leading-5 text-slate-400">
                可以在浏览器登录 B 站后，从开发者工具复制 Cookie（至少包含 SESSDATA 和 bili_jct）。
              </p>
              {showCookie ? (
                <div className="mt-4 space-y-2">
                  <textarea
                    value={cookieInput}
                    onChange={(event) => setCookieInput(event.target.value)}
                    rows={6}
                    placeholder="SESSDATA=...; bili_jct=...; DedeUserID=..."
                    className="w-full rounded-xl border border-black/[0.08] bg-[#fbfaf7] px-3 py-2 font-mono text-[11px] text-slate-700 outline-none focus:border-slate-400"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void saveCookie()}
                      disabled={busy || !cookieInput.trim()}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-950 px-4 text-xs font-black text-white disabled:opacity-40"
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} 保存并校验
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCookie(false)}
                      className="inline-flex h-9 items-center rounded-lg border border-black/[0.08] px-4 text-xs font-black text-slate-500"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCookie(true)}
                  className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/[0.08] px-4 text-xs font-black text-slate-700 transition hover:border-slate-300"
                >
                  <Unplug size={14} /> 粘贴 Cookie
                </button>
              )}
            </section>
          </div>
          </>
        ) : (
          <div className="mt-5 space-y-5">
            <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-black/[0.06] bg-white p-4">
              {profile?.face ? (
                <img
                  src={normalizeImage(profile.face)}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="h-12 w-12 rounded-full bg-slate-100 object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-300">
                  <Tv size={18} />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-black text-slate-950">{profile?.uname || connector?.publicConfig?.uname || '已连接'}</span>
                  {profile?.level ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-black text-slate-500">Lv.{profile.level}</span> : null}
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black text-emerald-600">已连接</span>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-[11px] font-semibold text-slate-400">
                  <span>粉丝 {formatCount(profile?.follower || 0)}</span>
                  <span>关注 {formatCount(profile?.following || 0)}</span>
                  {connector?.lastCheckedAt ? <span>校验于 {new Date(connector.lastCheckedAt).toLocaleString('zh-CN')}</span> : null}
                </div>
              </div>
              <a
                href="https://space.bilibili.com"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/[0.08] px-3 text-xs font-black text-slate-600 transition hover:border-slate-300"
              >
                <ExternalLink size={13} /> 打开 B 站
              </a>
            </section>

            <BilibiliDiscoveryCard spaceId={spaceId} />

            {pending.length > 0 && (
              <section className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
                <div className="mb-2 text-xs font-black text-amber-800">等你确认的 B 站操作（{pending.length}）</div>
                <div className="space-y-2">
                  {pending.slice(0, 3).map((action) => (
                    <div key={action.id} className="flex flex-wrap items-center gap-2 rounded-xl bg-white px-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-700">{action.title}</span>
                      <button
                        type="button"
                        onClick={() => void decide(action, 'approve')}
                        disabled={busy}
                        className="inline-flex h-8 items-center gap-1 rounded-lg bg-slate-950 px-3 text-[11px] font-black text-white disabled:opacity-40"
                      >
                        <Check size={12} /> 确认
                      </button>
                      <button
                        type="button"
                        onClick={() => void decide(action, 'reject')}
                        disabled={busy}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-black/[0.08] px-3 text-[11px] font-black text-slate-500 disabled:opacity-40"
                      >
                        <X size={12} /> 取消
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void runSearch(); }}
                  placeholder="搜索 B 站视频，回车确认"
                  className="h-9 w-full rounded-lg border border-black/[0.08] bg-white pl-9 pr-3 text-xs font-semibold text-slate-700 outline-none placeholder:text-slate-300 focus:border-slate-400"
                />
              </div>
              <button
                type="button"
                onClick={() => void runSearch()}
                disabled={searchLoading || !query.trim()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-950 px-4 text-xs font-black text-white disabled:opacity-40"
              >
                {searchLoading ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} 搜索
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {TABS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { clearSearch(); setTab(item.id); setActiveFolder(''); }}
                  className={`inline-flex h-9 items-center gap-1 rounded-lg px-3 text-xs font-black transition ${tab === item.id && searchResults === null ? 'bg-slate-950 text-white' : 'border border-black/[0.08] bg-white text-slate-500 hover:border-slate-300'}`}
                >
                  {item.id === 'hot' ? <Flame size={13} /> : null}
                  {item.label}
                </button>
              ))}
              {fetchedAt && searchResults === null && tab !== 'hot' ? (
                <span className="ml-auto text-[11px] font-semibold text-slate-400">
                  {cached ? '缓存' : '刚刚更新'} · {new Date(fetchedAt).toLocaleTimeString('zh-CN')}
                </span>
              ) : null}
            </div>

            {searchResults !== null ? (
              <>
                <div className="flex items-center justify-between">
                  <div className="text-xs font-black text-slate-500">「{searchQuery}」的搜索结果（{searchResults.length}）</div>
                  <button type="button" onClick={clearSearch} className="text-[11px] font-bold text-slate-400 hover:text-slate-900">
                    清除搜索
                  </button>
                </div>
                {searchLoading ? (
                  <div className="flex justify-center py-6"><Loader2 className="animate-spin text-slate-300" size={20} /></div>
                ) : (
                  renderVideoList(searchResults, '没有搜到视频，换个关键词试试。')
                )}
              </>
            ) : tab === 'hot' ? (
              hotLoading ? (
                <div className="flex justify-center py-10"><Loader2 className="animate-spin text-slate-300" size={22} /></div>
              ) : (
                renderVideoList(hotItems, '暂时没有读到 B 站热门，点右上角刷新试试。')
              )
            ) : tab === 'favorites' && !activeFolder ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {folders.length === 0 && !dataLoading ? (
                  <div className="col-span-full rounded-2xl border border-dashed border-black/[0.08] bg-white p-8 text-center text-xs font-semibold text-slate-400">
                    还没有收藏夹，或 B 站没有返回数据。
                  </div>
                ) : null}
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    onClick={() => void openFolder(folder)}
                    className="rounded-2xl border border-black/[0.06] bg-white p-4 text-left transition hover:border-slate-300"
                  >
                    <div className="text-sm font-black text-slate-900">{folder.title}</div>
                    <div className="mt-1 text-[11px] font-semibold text-slate-400">{folder.count} 个视频</div>
                  </button>
                ))}
              </div>
            ) : (
              <>
                {tab === 'favorites' && activeFolder ? (
                  <button
                    type="button"
                    onClick={() => { setActiveFolder(''); void loadData({ tab: 'favorites' }); }}
                    className="inline-flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-slate-900"
                  >
                    <ArrowLeft size={13} /> 返回收藏夹
                  </button>
                ) : null}

                {tab === 'likes' ? (
                  <div className="rounded-xl border border-black/[0.06] bg-white px-3 py-2 text-[11px] font-semibold text-slate-400">
                    B 站只提供最近约 20 条点赞记录，没有分页。
                  </div>
                ) : null}
                {tab === 'history' ? (
                  <div className="rounded-xl border border-black/[0.06] bg-white px-3 py-2 text-[11px] font-semibold text-slate-400">
                    展示最近 30 条观看记录。
                  </div>
                ) : null}

                {renderVideoList(
                  items,
                  emptyTextForTab(tab),
                  tab === 'likes' ? 'likes' : tab === 'favorites' ? 'favorites' : 'default'
                )}

                {dataLoading ? (
                  <div className="flex justify-center py-6"><Loader2 className="animate-spin text-slate-300" size={20} /></div>
                ) : null}

                {hasMore && !dataLoading && tab !== 'history' ? (
                  <div className="flex justify-center pb-4">
                    <button
                      type="button"
                      onClick={() => void loadMore()}
                      className="inline-flex h-9 items-center rounded-lg border border-black/[0.08] bg-white px-4 text-xs font-black text-slate-600 hover:border-slate-300"
                    >
                      加载更多
                    </button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>

      {intent ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => !busy && setIntent(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="text-sm font-black text-slate-950">确认{ACTION_LABEL[intent.kind]}？</div>
            <p className="mt-2 line-clamp-3 text-xs font-semibold leading-5 text-slate-500">{intent.item.title}</p>
            {intent.kind === 'BILIBILI_FAVORITE' ? (
              <div className="mt-3">
                <label className="text-[11px] font-black text-slate-400">收藏到</label>
                <select
                  value={intent.mediaId || ''}
                  onChange={(event) => setIntent({ ...intent, mediaId: event.target.value })}
                  className="mt-1 h-9 w-full rounded-lg border border-black/[0.08] bg-white px-2 text-xs font-bold text-slate-700"
                >
                  <option value="">选择收藏夹</option>
                  {favoriteFolders.map((folder) => (
                    <option key={folder.id} value={folder.id}>{folder.title}</option>
                  ))}
                </select>
                {favoriteFolders.length === 0 ? (
                  <div className="mt-1 text-[11px] font-semibold text-rose-500">没有读到收藏夹，请先去「收藏夹」Tab 刷新。</div>
                ) : null}
              </div>
            ) : null}
            <p className="mt-3 text-[11px] font-semibold leading-4 text-slate-400">
              提交后会生成一条待审批动作，你在面板或对话里确认后才会真正执行。
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIntent(null)}
                disabled={busy}
                className="inline-flex h-9 items-center rounded-lg border border-black/[0.08] px-4 text-xs font-black text-slate-500 disabled:opacity-40"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submitAction()}
                disabled={busy}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-950 px-4 text-xs font-black text-white disabled:opacity-40"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} 提交审批
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {detail ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={() => setDetail(null)}>
          <div
            className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/[0.06] bg-white/95 px-5 py-3 backdrop-blur">
              <div className="text-sm font-black text-slate-950">视频解析</div>
              <button type="button" onClick={() => setDetail(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900">
                <X size={18} />
              </button>
            </div>

            {(error || notice) ? (
              <div className={`mx-5 mt-4 rounded-xl px-4 py-2 text-xs font-semibold ${error ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-700'}`}>
                {error || notice}
              </div>
            ) : null}

            {detail.loading ? (
              <div className="flex h-64 items-center justify-center"><Loader2 className="animate-spin text-slate-300" size={22} /></div>
            ) : detail.error ? (
              <div className="p-5">
                <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">{detail.error}</div>
              </div>
            ) : detailVideo ? (
              <div className="space-y-5 p-5">
                {detailVideo.cover ? (
                  <img
                    src={normalizeImage(detailVideo.cover)}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="aspect-video w-full rounded-2xl bg-slate-100 object-cover"
                  />
                ) : null}

                <div>
                  <h3 className="text-base font-black leading-6 text-slate-950">{detailVideo.title}</h3>
                  <div className="mt-2 flex flex-wrap gap-3 text-[11px] font-semibold text-slate-400">
                    {detailVideo.author ? <span>UP：{detailVideo.author}</span> : null}
                    {detailVideo.duration > 0 ? <span>{formatDuration(detailVideo.duration)}</span> : null}
                    {detailVideo.pubdate ? <span>{formatDate(detailVideo.pubdate)}</span> : null}
                  </div>
                  {detailVideo.stat ? (
                    <div className="mt-2 flex flex-wrap gap-3 text-[11px] font-semibold text-slate-400">
                      <span>播放 {formatCount(detailVideo.stat.view)}</span>
                      <span>点赞 {formatCount(detailVideo.stat.like)}</span>
                      <span>投币 {formatCount(detailVideo.stat.coin)}</span>
                      <span>收藏 {formatCount(detailVideo.stat.favorite)}</span>
                      <span>评论 {formatCount(detailVideo.stat.reply)}</span>
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={sendToAgent}
                    disabled={!onSendMessage}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-950 px-4 text-xs font-black text-white disabled:opacity-40"
                  >
                    <Sparkles size={13} /> 让 Agent 拆解
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyDetail()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/[0.08] px-3 text-xs font-black text-slate-600 hover:border-slate-300"
                  >
                    <Copy size={13} /> 复制全文
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveToSpace()}
                    disabled={busy}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/[0.08] px-3 text-xs font-black text-slate-600 hover:border-slate-300 disabled:opacity-40"
                  >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} 存到空间
                  </button>
                  <a
                    href={detailVideo.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-black/[0.08] px-3 text-xs font-black text-slate-600 hover:border-slate-300"
                  >
                    <ExternalLink size={13} /> 在 B 站打开
                  </a>
                </div>

                <div className="flex flex-wrap gap-2">
                  {detail?.source !== 'likes' ? (
                    <ActionButton
                      icon={<Heart size={12} />}
                      label="点赞"
                      disabled={busy || pendingFor.has(`BILIBILI_LIKE:${detailVideo.bvid}`)}
                      pending={pendingFor.has(`BILIBILI_LIKE:${detailVideo.bvid}`)}
                      onClick={() => setIntent({ kind: 'BILIBILI_LIKE', item: detailVideo })}
                    />
                  ) : null}
                  <ActionButton
                    icon={<Coins size={12} />}
                    label="投币"
                    disabled={busy || pendingFor.has(`BILIBILI_COIN:${detailVideo.bvid}`)}
                    pending={pendingFor.has(`BILIBILI_COIN:${detailVideo.bvid}`)}
                    onClick={() => setIntent({ kind: 'BILIBILI_COIN', item: detailVideo })}
                  />
                  {detail?.source !== 'favorites' ? (
                    <ActionButton
                      icon={<Star size={12} />}
                      label="收藏"
                      disabled={busy || pendingFor.has(`BILIBILI_FAVORITE:${detailVideo.bvid}`)}
                      pending={pendingFor.has(`BILIBILI_FAVORITE:${detailVideo.bvid}`)}
                      onClick={() => setIntent({ kind: 'BILIBILI_FAVORITE', item: detailVideo, mediaId: favoriteFolders[0]?.id })}
                    />
                  ) : null}
                </div>

                {detailVideo.desc ? (
                  <section>
                    <h4 className="text-xs font-black text-slate-500">简介</h4>
                    <p className="mt-1 whitespace-pre-wrap text-xs font-semibold leading-5 text-slate-600">{detailVideo.desc}</p>
                  </section>
                ) : null}

                <section>
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black text-slate-500">字幕 / 正文</h4>
                    {detailVideo.hasSubtitle ? (
                      <span className="text-[10px] font-bold text-emerald-600">已拿到字幕</span>
                    ) : (
                      <span className="text-[10px] font-bold text-slate-400">无字幕</span>
                    )}
                  </div>
                  {detailVideo.subtitleText ? (
                    <pre className="mt-2 max-h-[45vh] overflow-y-auto whitespace-pre-wrap rounded-xl bg-[#fbfaf7] p-4 font-sans text-xs leading-6 text-slate-700">
                      {detailVideo.subtitleText.slice(0, 20000)}
                      {detailVideo.subtitleText.length > 20000 ? '\n\n…（展示已截断，复制全文可拿到完整字幕）' : ''}
                    </pre>
                  ) : (
                    <p className="mt-2 rounded-xl bg-[#fbfaf7] p-4 text-xs font-semibold leading-5 text-slate-400">
                      这条视频没有可用字幕。可以基于标题、简介让 Agent 先做初步判断
                      {detail.data?.asrEnabled ? '；如确需逐字稿，Agent 会先说明 ASR 可能耗时并征求你的确认，确认后才会转写。' : '。'}
                    </p>
                  )}
                </section>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {showGuide ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={() => setShowGuide(false)}>
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-black text-slate-950">B 站空间怎么用</h3>
                <p className="mt-1 text-xs font-semibold text-slate-400">看 → 拆解 → 审批互动，四步就够了。</p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
              >
                <X size={18} />
              </button>
            </div>

            <ol className="mt-5 space-y-4">
              <GuideStep index={1} title="连接账号">
                扫码，或粘贴浏览器里的 Cookie。只会读取你的观看历史、点赞、收藏和稿件；Cookie 只存在服务端，前端不会回显。
              </GuideStep>
              <GuideStep index={2} title="先看，再找">
                「最近看过」「我点赞的」「收藏夹」「我的稿件」看自己的数据；「B站热门」和顶部搜索用来发现新视频。
              </GuideStep>
              <GuideStep index={3} title="拆解一条视频">
                点标题或封面打开详情，能看到简介和字幕。点「让 Agent 拆解」会把链接和字幕发到空间对话；点「存到空间」会写进「成果」里的 shared 资料。
              </GuideStep>
              <GuideStep index={4} title="互动要审批">
                点赞、投币、收藏不会直接执行。提交后会出现在面板顶部的「等你确认的 B 站操作」里，你在那里或对话里确认后才真正执行。单日最多 50 次，间隔至少 3 秒。
              </GuideStep>
            </ol>

            <div className="mt-5 rounded-xl bg-[#fbfaf7] p-3 text-[11px] font-semibold leading-5 text-slate-500">
              小提示：字幕不是每条视频都有；没有字幕时，Agent 仍可以基于标题、简介和 UP 主信息做初步判断。
            </div>

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="mt-4 h-9 w-full rounded-lg bg-slate-950 text-xs font-black text-white"
            >
              知道了
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActionButton({ icon, label, pending, disabled, onClick }: {
  icon: ReactNode;
  label: string;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] font-black transition ${pending ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-black/[0.08] text-slate-600 hover:border-slate-300'} disabled:opacity-50`}
    >
      {icon} {pending ? '待确认' : label}
    </button>
  );
}

function GuideStep({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-950 text-[11px] font-black text-white">
        {index}
      </span>
      <div className="min-w-0">
        <div className="text-xs font-black text-slate-900">{title}</div>
        <div className="mt-0.5 text-[11px] font-semibold leading-5 text-slate-500">{children}</div>
      </div>
    </li>
  );
}
