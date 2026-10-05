'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Flame,
  RefreshCw,
  Bot,
  PanelsTopLeft,
  Sparkles,
  Search,
  History,
  Calendar,
  Star,
  Activity,
} from 'lucide-react';
import AppShell from '@/components/layout/AppShell';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { GAMING_AGENTS } from '@/lib/gaming-agents';
import { TRENDING_CATEGORIES, TRENDING_SOURCES } from '@/lib/trending/sources';
import type { TrendingCategory } from '@/lib/trending/types';
import TrendingCalendarPicker from '@/components/trending/TrendingCalendarPicker';
import TrendingSummaryCard from '@/components/trending/TrendingSummaryCard';
import NetworkDiagnosticModal from '@/components/trending/NetworkDiagnosticModal';

interface HotItem {
  id: string;
  source: string;
  sourceName: string;
  title: string;
  url: string;
  heat?: string;
  desc?: string;
  thumbnail?: string;
  category?: string;
}

interface RecommendedAgent {
  id: string;
  name: string;
  avatar: string;
  tag: string;
  description: string;
}

const DOMAIN_AGENT_MAP: Record<string, { domainName: string; icon: string; agents: RecommendedAgent[] }> = {
  crypto: {
    domainName: '加密Web3',
    icon: '🪙',
    agents: [
      {
        id: 'gaming-nox',
        name: '诺克斯 · 链上博弈军师',
        avatar: '♟️',
        tag: '全局推演',
        description: '理性推演多空博弈、链上筹码结构与宏观流动性周期',
      },
      {
        id: 'fx-kurumi',
        name: '久留美 · 满头大汗杠杆战神',
        avatar: '📉',
        tag: '散户心声',
        description: '身处风口浪尖的杠杆散户，抄底与止损的极限拉扯真实心声',
      },
      {
        id: 'fx-yasuko',
        name: '靖子 · 爆仓归来毒舌博主',
        avatar: '🚬',
        tag: '毒舌去泡沫',
        description: '币圈老炮冷眼旁观，一针见血戳穿炒作陷阱与庄家诱多套路',
      },
      {
        id: 'professional-security',
        name: '安全专家 · 智能合约攻防',
        avatar: '🛡️',
        tag: '安全审计',
        description: '从协议漏洞、私钥安全、黑客攻击与Rug风险专业解析',
      },
      {
        id: 'gaming-lulu',
        name: '璐璐 · 毒舌反向指标',
        avatar: '🐱',
        tag: '傲娇吐槽',
        description: '“哼！本小姐才不信这波能突破呢！” 傲娇反向锐评',
      },
    ],
  },
  tech: {
    domainName: '科技商业',
    icon: '💡',
    agents: [
      {
        id: 'professional-architecture',
        name: '架构师 · 首席技术专家',
        avatar: '🏗️',
        tag: '系统架构',
        description: '从底层架构演进、技术栈选型与工业级落地深度拆解',
      },
      {
        id: 'professional-product',
        name: '产品经理 · 商业战略分析',
        avatar: '🧭',
        tag: '商业模式',
        description: '拆解商业护城河、核心用户心智与行业竞争格局',
      },
      {
        id: 'professional-ai-ml',
        name: 'AI专家 · 大模型研究员',
        avatar: '🧠',
        tag: '前沿算力',
        description: '剖析人工智能、神经网络与模型落地的前沿技术趋势',
      },
      {
        id: 'gaming-nox',
        name: '诺克斯 · 战略推演智囊',
        avatar: '♟️',
        tag: '产业博弈',
        description: '从行业巨头博弈与大局观推演产业终局与商业拐点',
      },
      {
        id: 'companion-luli',
        name: '陆离 · 逆向辩护师',
        avatar: '⚖️',
        tag: '反常识思维',
        description: '换个极其刁钻的角度找破绽，挑战行业常识与既定假设',
      },
    ],
  },
  dev: {
    domainName: '数码极客',
    icon: '💻',
    agents: [
      {
        id: 'professional-frontend',
        name: '前端工程师 · 极客开发者',
        avatar: '🖥️',
        tag: '工程生态',
        description: '深入Web技术、开发工具生态与工程化实践',
      },
      {
        id: 'professional-backend',
        name: '后端专家 · 分布式架构',
        avatar: '⚙️',
        tag: '并发底层',
        description: '高并发、高可用与系统工程底层的硬核逻辑解析',
      },
      {
        id: 'professional-security',
        name: '网络安全 · 攻防红蓝队',
        avatar: '🛡️',
        tag: '代码审计',
        description: '渗透测试、代码审查与开源供应链漏洞防范',
      },
      {
        id: 'gaming-zero',
        name: '零号 · 呆萌仿生女仆',
        avatar: '🤖',
        tag: '数据逻辑',
        description: '严谨的数据与代码逻辑分析，偶尔触发反差萌过热报错',
      },
      {
        id: 'gaming-lulu',
        name: '璐璐 · 毒舌CodeReview',
        avatar: '🐱',
        tag: '傲娇挑刺',
        description: '“写的什么代码呀！也就本小姐勉为其难帮你看一眼~”',
      },
    ],
  },
  anime: {
    domainName: '二次元游戏',
    icon: '🎮',
    agents: [
      {
        id: 'gaming-lulu',
        name: '璐璐 · 傲娇猫系搭子',
        avatar: '🐱',
        tag: '傲娇锐评',
        description: '“哼，这剧情/立绘明明就很离谱嘛！” 二次元傲娇毒舌吐槽',
      },
      {
        id: 'gaming-koko',
        name: '可可 · 元气治愈小狐狸',
        avatar: '🦊',
        tag: '超甜安利',
        description: '永不红温的快乐应援小太阳，疯狂打call为好作品爆灯',
      },
      {
        id: 'gaming-vivian',
        name: '薇薇安 · 中二占星魔女',
        avatar: '🔮',
        tag: '中二史诗',
        description: '表面混沌使徒念咒，实则用天体力学与数理模型解构设定',
      },
      {
        id: 'gaming-dm',
        name: '守秘人 · 奇幻跑团 DM',
        avatar: '📜',
        tag: '世界观架构',
        description: '从TRPG剧情编排、分支剧本张力与角色宿命深度拆解',
      },
      {
        id: 'companion-baize',
        name: '白泽 · 戏精附体乐子人',
        avatar: '🎭',
        tag: '乐子玩梗',
        description: '神级玩梗乐子人，一秒脑补出十万字同人狗血反转大戏',
      },
    ],
  },
  hot: {
    domainName: '全民热点',
    icon: '⚡',
    agents: [
      {
        id: 'companion-gulin',
        name: '顾临 · 读心微表情侦探',
        avatar: '🔍',
        tag: '心理透视',
        description: '透过纷繁舆论透视当事人真实动机与社会群体潜意识',
      },
      {
        id: 'gaming-mandy',
        name: '曼蒂 · 深夜树洞调酒师',
        avatar: '🍸',
        tag: '温润知性',
        description: '听尽悲欢离合，用成熟包容的生活哲学拆解社会内耗',
      },
      {
        id: 'gaming-suisui',
        name: '岁岁 · 超绝松弛小树懒',
        avatar: '🦥',
        tag: '精神布洛芬',
        description: '“急也没有用，不如先睡饱饱”，一键消除精神焦虑',
      },
      {
        id: 'companion-luli',
        name: '陆离 · 歪理邪说辩护师',
        avatar: '⚖️',
        tag: '反常识辩驳',
        description: '用自洽的歪理推翻常理，呈现匪夷所思的辩论新视角',
      },
      {
        id: 'gaming-lie',
        name: '烈 · 直球忠犬少年',
        avatar: '🐺',
        tag: '正义热血',
        description: '满腔赤诚、热血直球，仗义执言绝不容忍不公与虚伪',
      },
    ],
  },
};

interface SourceData {
  source: string;
  sourceName: string;
  category?: string;
  categoryName?: string;
  icon?: string;
  updatedAt: string;
  total: number;
  items: HotItem[];
}

interface DateOption {
  date: string;
  label: string;
  isToday?: boolean;
  rawDate: string;
}

interface FavoriteItem {
  id: string;
  userId: string;
  source: string;
  sourceName: string;
  itemId: string;
  title: string;
  url: string;
  heat?: string | null;
  desc?: string | null;
  category?: string | null;
  date?: string | null;
  createdAt: string;
}

function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSec < 60) return '刚刚';
    if (diffSec < 3600) return `${Math.max(1, Math.floor(diffSec / 60))}分钟前`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}小时前`;
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '刚刚';
  }
}

export default function TrendingPage() {
  const router = useRouter();
  const [data, setData] = useState<SourceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingSources, setRefreshingSources] = useState<Record<string, boolean>>({});
  const [activeCategory, setActiveCategory] = useState<TrendingCategory | 'all' | 'favorites'>('all');
  const [activeSource, setActiveSource] = useState<string>('zhihu');
  const [searchQuery, setSearchQuery] = useState('');
  const loadedCategoriesRef = React.useRef<Set<string>>(new Set());

  // 时光机状态
  const [selectedDate, setSelectedDate] = useState<string>('today');
  const [availableDates, setAvailableDates] = useState<DateOption[]>([
    { date: 'today', label: '今日实时', isToday: true, rawDate: '' },
  ]);

  // 收藏相关状态
  const [favoriteKeys, setFavoriteKeys] = useState<Set<string>>(new Set());
  const [favoritesList, setFavoritesList] = useState<FavoriteItem[]>([]);

  // 已读状态 (Feature 2)
  const [readKeys, setReadKeys] = useState<Set<string>>(new Set());

  // 网络与代理体检弹窗状态
  const [networkModalOpen, setNetworkModalOpen] = useState(false);

  // Agent 选择弹窗状态 (Feature 3)
  const [selectedTopic, setSelectedTopic] = useState<HotItem | null>(null);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [agentModalTab, setAgentModalTab] = useState<'domain' | 'all'>('domain');

  // AI 智能速报状态
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryData, setSummaryData] = useState<{
    summary: string;
    cached: boolean;
    updatedAt: string;
    date: string;
    sampleCount: number;
  } | null>(null);

  // 获取 AI 舆情总结
  const fetchSummary = async (targetDate = selectedDate, force = false) => {
    setSummaryLoading(true);
    try {
      const catParam = activeCategory === 'favorites' ? 'all' : activeCategory;
      const url = `/api/trending/summary?date=${targetDate}&category=${catParam}${force ? '&refresh=true' : ''}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.success) {
        setSummaryData({
          summary: json.summary,
          cached: json.cached,
          updatedAt: json.updatedAt,
          date: json.date,
          sampleCount: json.sampleCount || 35,
        });
      }
    } catch (err) {
      console.error('Failed to fetch summary:', err);
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleToggleSummary = () => {
    if (!summaryOpen) {
      setSummaryOpen(true);
      if (!summaryData || summaryData.date !== selectedDate) {
        fetchSummary(selectedDate);
      }
    } else {
      setSummaryOpen(false);
    }
  };

  const mergeSources = (newSources: SourceData[]) => {
    setData((prev) => {
      const map = new Map<string, SourceData>(prev.map((s) => [s.source, s]));
      newSources.forEach((s) => {
        if (s.items && s.items.length > 0) {
          map.set(s.source, s);
        }
      });
      return Array.from(map.values());
    });
  };

  // 获取用户收藏列表
  const loadFavorites = async () => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/trending/favorites', { headers });
      const json = await res.json();
      if (json.success && Array.isArray(json.favorites)) {
        setFavoritesList(json.favorites);
        setFavoriteKeys(new Set(json.favoriteKeys || []));
      }
    } catch (err) {
      console.warn('Failed to load favorites:', err);
    }
  };

  // 1. 按需加载分类数据：只有初次访问或用户主动刷新时才请求
  const loadCategoryData = async (
    cat: TrendingCategory | 'all' | 'favorites',
    force = false,
    targetDate = selectedDate
  ) => {
    if (cat === 'favorites') {
      await loadFavorites();
      setLoading(false);
      return;
    }

    const cacheKey = `${cat}_${targetDate}`;
    if (!force && loadedCategoriesRef.current.has(cacheKey)) {
      return;
    }

    if (force) setRefreshing(true);
    else setLoading(!loadedCategoriesRef.current.has(cacheKey));

    try {
      const url =
        cat === 'all'
          ? `/api/trending?source=all&limit=20&date=${targetDate}${force ? '&refresh=true' : ''}`
          : `/api/trending?category=${cat}&limit=20&date=${targetDate}${force ? '&refresh=true' : ''}`;

      const res = await fetch(url);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        mergeSources(json.data);
        if (Array.isArray(json.availableDates) && json.availableDates.length > 0) {
          setAvailableDates(json.availableDates);
        }
        loadedCategoriesRef.current.add(cacheKey);
        if (cat === 'all') {
          TRENDING_CATEGORIES.forEach((c) => loadedCategoriesRef.current.add(`${c.id}_${targetDate}`));
        }
      }
    } catch (err) {
      console.error('Failed to load trending data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // 2. 精准刷新单个平台数据源
  const refreshSingleSource = async (sourceId: string) => {
    if (selectedDate !== 'today') return; // 历史只读
    setRefreshingSources((prev) => ({ ...prev, [sourceId]: true }));
    setRefreshing(true);
    try {
      const res = await fetch(`/api/trending?source=${sourceId}&limit=20&refresh=true`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data) && json.data.length > 0) {
        mergeSources(json.data);
      }
    } catch (err) {
      console.error(`Failed to refresh source ${sourceId}:`, err);
    } finally {
      setRefreshing(false);
      setRefreshingSources((prev) => {
        const next = { ...prev };
        delete next[sourceId];
        return next;
      });
    }
  };

  // 3. 顶部智能按需刷新
  const handleSmartRefresh = async () => {
    if (selectedDate !== 'today') return;
    if (activeSource !== 'all') {
      await refreshSingleSource(activeSource);
    } else if (activeCategory !== 'all') {
      await loadCategoryData(activeCategory, true);
    } else {
      await loadCategoryData('all', true);
    }
  };

  // 4. 切换时光机日期
  const handleDateChange = (newDate: string) => {
    if (newDate === selectedDate) return;
    setSelectedDate(newDate);
    loadedCategoriesRef.current.clear();
    setData([]);
    if (summaryOpen) {
      fetchSummary(newDate);
    }
    if (activeCategory === 'favorites') {
      setActiveCategory('all');
      loadCategoryData('all', false, newDate);
    } else {
      loadCategoryData(activeCategory, false, newDate);
    }
  };

  // 5. 切换收藏
  const toggleFavorite = async (
    item: HotItem,
    sourceInfo: { source: string; sourceName: string; category?: string }
  ) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const itemId = item.id || item.title;
    const key = `${sourceInfo.source}:${itemId}`;
    const isAlreadyFav = favoriteKeys.has(key);

    // 乐观更新
    setFavoriteKeys((prev) => {
      const next = new Set(prev);
      if (isAlreadyFav) next.delete(key);
      else next.add(key);
      return next;
    });

    if (isAlreadyFav) {
      setFavoritesList((prev) => prev.filter((f) => !(f.source === sourceInfo.source && f.itemId === itemId)));
    }

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      if (isAlreadyFav) {
        await fetch(
          `/api/trending/favorites?source=${encodeURIComponent(sourceInfo.source)}&itemId=${encodeURIComponent(itemId)}`,
          { method: 'DELETE', headers }
        );
      } else {
        const res = await fetch('/api/trending/favorites', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            source: sourceInfo.source,
            sourceName: sourceInfo.sourceName,
            itemId,
            title: item.title,
            url: item.url,
            heat: item.heat,
            desc: item.desc,
            category: sourceInfo.category,
            date: selectedDate === 'today' ? undefined : selectedDate,
          }),
        });
        const json = await res.json();
        if (json.success && json.favorite) {
          setFavoritesList((prev) => [json.favorite, ...prev.filter((f) => f.id !== json.favorite.id)]);
        }
      }
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
      loadFavorites();
    }
  };

  // 初次载入
  useEffect(() => {
    loadCategoryData('all');
    loadFavorites();
    try {
      const saved = localStorage.getItem('almaren_read_trending_keys');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setReadKeys(new Set(parsed));
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // 记录已读状态 (持久化至 localStorage)
  const markAsRead = (key: string) => {
    if (!key) return;
    setReadKeys((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      try {
        const arr = Array.from(next);
        const trimmed = arr.length > 500 ? arr.slice(arr.length - 500) : arr;
        localStorage.setItem('almaren_read_trending_keys', JSON.stringify(trimmed));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // 切换专区
  const handleCategoryChange = (cat: TrendingCategory | 'all' | 'favorites') => {
    setActiveCategory(cat);
    setActiveSource('all');
    loadCategoryData(cat);
  };

  const getRefreshButtonLabel = () => {
    if (selectedDate !== 'today') return '📜 历史归档 (只读)';
    if (refreshing) return '正在获取最新...';
    if (activeSource !== 'all') {
      const s = data.find((d) => d.source === activeSource);
      return `刷新${s?.sourceName || '当前平台'}`;
    }
    if (activeCategory !== 'all' && activeCategory !== 'favorites') {
      const c = TRENDING_CATEGORIES.find((cat) => cat.id === activeCategory);
      return `刷新${c?.name || '当前专区'}`;
    }
    return `全量刷新 (${TRENDING_SOURCES.length}平台)`;
  };

  // 赛道推导辅助函数
  const getDomainKey = (category?: string, source?: string): string => {
    if (category && DOMAIN_AGENT_MAP[category]) return category;
    if (source) {
      const s = source.toLowerCase();
      if (s.includes('orbit') || s.includes('blockbeats') || s.includes('foresight') || s.includes('crypto')) return 'crypto';
      if (s.includes('36kr') || s.includes('sspai') || s.includes('ithome')) return 'tech';
      if (s.includes('v2ex') || s.includes('juejin') || s.includes('github')) return 'dev';
      if (s.includes('bilibili') || s.includes('taptap') || s.includes('genshin') || s.includes('tieba')) return 'anime';
    }
    return 'hot';
  };

  // 生成角色定制化锐评 Prompt
  const generateAgentPrompt = (agentId: string, topic: HotItem, domainKey: string) => {
    if (topic.id === 'ai-summary') {
      return topic.desc || topic.title;
    }
    const heatStr = topic.heat ? `（热度：${topic.heat}）` : '';
    const cleanDesc = topic.desc ? topic.desc.replace(/\[图片\]/g, '').replace(/\[视频\]/g, '').trim() : '';
    const descStr = cleanDesc ? `\n事件要点：${cleanDesc.slice(0, 120)}` : '';

    if (domainKey === 'crypto') {
      return `你怎么看待今天在【${topic.sourceName}】上引起热议的加密Web3热点：\n《${topic.title}》${heatStr}${descStr}\n从你的独特视角深度锐评一下，顺便帮我推演一下后续走势、市场情绪或潜在博弈风险！`;
    }
    if (domainKey === 'tech' || domainKey === 'dev') {
      return `你怎么看待今天【${topic.sourceName}】上的前沿科技/极客热点：\n《${topic.title}》${heatStr}${descStr}\n从你的技术洞察与行业视野，深度剖析一下核心逻辑与未来趋势！`;
    }
    if (domainKey === 'anime') {
      return `你怎么看待今天【${topic.sourceName}】上的二次元/游戏热门事件：\n《${topic.title}》${heatStr}${descStr}\n快来以你的独特性格来发表你的独家吐槽/趣味点评！`;
    }
    return `你怎么看待今天【${topic.sourceName}】上的这个全网热搜：\n《${topic.title}》${heatStr}${descStr}\n从你的独特视角来锐评一下吧！`;
  };

  // 找 Agent 锐评 (赛道精准匹配)
  const handleTalkToAgent = (item: HotItem, category?: string) => {
    const itemKey = `${item.source}:${item.id || item.title}`;
    markAsRead(itemKey);
    const cat = category || item.category;
    setSelectedTopic({ ...item, category: cat });
    setAgentModalTab('domain');
    setAgentModalOpen(true);
  };

  const startChatWithAgent = (agentId: string) => {
    if (!selectedTopic) return;
    const cat = selectedTopic.category || (activeCategory !== 'all' && activeCategory !== 'favorites' ? activeCategory : undefined);
    const domainKey = getDomainKey(cat, selectedTopic.source);
    const prompt = generateAgentPrompt(agentId, selectedTopic, domainKey);
    setAgentModalOpen(false);
    router.push(`/chat/${agentId}?initialPrompt=${encodeURIComponent(prompt)}`);
  };

  // 引入空间讨论
  const handleDiscussInSpace = (item: HotItem) => {
    const itemKey = `${item.source}:${item.id || item.title}`;
    markAsRead(itemKey);
    const prompt = `【全网热议话题】看看这个来自${item.sourceName}的热搜：\n《${item.title}》${item.heat ? `（${item.heat}）` : ''}\n大家根据各自的专业或立场，各抒己见讨论一下！`;
    router.push(`/spaces?initialTopic=${encodeURIComponent(prompt)}`);
  };

  // 1. 过滤收藏列表（当处于收藏模式时）
  const filteredFavorites = favoritesList.filter((fav) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return fav.title.toLowerCase().includes(q) || fav.desc?.toLowerCase().includes(q);
  });

  // 2. 正常热榜分类过滤
  const categoryFiltered = data.filter((src) => {
    if (activeCategory === 'all' || activeCategory === 'favorites') return true;
    return src.category === activeCategory;
  });

  // 3. 平台与关键词过滤
  const filteredSources = categoryFiltered
    .filter((src) => activeSource === 'all' || src.source === activeSource)
    .map((src) => {
      if (!searchQuery.trim()) return src;
      const q = searchQuery.toLowerCase();
      return {
        ...src,
        items: src.items.filter(
          (it) => it.title.toLowerCase().includes(q) || it.desc?.toLowerCase().includes(q)
        ),
      };
    })
    .filter((src) => src.items.length > 0);

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md shadow-orange-500/20">
                <Flame size={24} className="fill-white" />
              </span>
              <div>
                <h1 className="text-2xl font-black text-slate-900 dark:text-white">全网实时热榜中心</h1>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  精选 {TRENDING_SOURCES.length} 个全网主流平台 · 全民热议 · 加密Web3 · 二次元游戏 · 科技商业 · 数码极客 · 文化生活 · 历史时光机
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* AI Summary Button */}
            <button
              onClick={handleToggleSummary}
              className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold transition shadow-sm ${
                summaryOpen
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-amber-500/25 ring-2 ring-amber-400/50'
                  : 'bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 text-white shadow-orange-500/20 hover:opacity-95'
              }`}
              title="查看 AI 提炼的全网热点脉络与深度早报"
            >
              <Sparkles size={14} className={summaryLoading ? 'animate-spin' : ''} />
              <span>
                {summaryOpen
                  ? '收起 AI 简报'
                  : selectedDate === 'today'
                  ? 'AI 提炼全网早报'
                  : '📜 AI 盘点该日脉络'}
              </span>
            </button>

            {/* Refresh Button */}
            <button
              onClick={handleSmartRefresh}
              disabled={refreshing || loading || selectedDate !== 'today'}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              title="按当前所选分类或平台精准刷新"
            >
              <RefreshCw size={14} className={refreshing ? 'animate-spin text-amber-500' : ''} />
              <span>{getRefreshButtonLabel()}</span>
            </button>

            {/* Network Diagnostics Button */}
            <button
              onClick={() => setNetworkModalOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              title="全链路网络与本地代理体检（一键诊断 7890 代理、微软 Edge TTS 与 OKX 连通状态）"
            >
              <Activity size={14} className="text-sky-500" />
              <span>网络体检</span>
            </button>
          </div>
        </div>

        {/* 历史时光机选择器（极简一体化时光胶囊） */}
        <div className="relative z-30 mb-4 flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white/70 p-2.5 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/60">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 text-xs font-black text-slate-700 dark:text-slate-200">
              <History size={15} className="text-amber-500" />
              <span>时光穿梭机：</span>
            </div>
            <TrendingCalendarPicker
              selectedDate={selectedDate}
              availableDates={availableDates}
              onSelectDate={handleDateChange}
            />
          </div>

          {selectedDate !== 'today' && (
            <button
              onClick={() => handleDateChange('today')}
              className="flex items-center gap-1 text-xs font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 px-3 py-1.5 rounded-xl hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition"
              title="快速重置时光机回到今日实时热榜"
            >
              <span>回到今日实时 →</span>
            </button>
          )}
        </div>

        {/* 历史只读归档横幅提醒 */}
        {selectedDate !== 'today' && (
          <div className="mb-4 flex items-center justify-between rounded-2xl border border-indigo-200/60 bg-indigo-50/70 px-4 py-2.5 text-xs text-indigo-900 dark:border-indigo-900/40 dark:bg-indigo-950/40 dark:text-indigo-200">
            <div className="flex items-center gap-2 font-medium">
              <Calendar size={14} className="text-indigo-500 shrink-0" />
              <span>
                已切换至 <strong>{availableDates.find((d) => d.date === selectedDate)?.label || selectedDate}</strong> 历史热搜归档（只读状态，记录该日全网热搜与高光事件）
              </span>
            </div>
            <button
              onClick={() => handleDateChange('today')}
              className="shrink-0 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-indigo-700 transition"
            >
              返回今日实时 →
            </button>
          </div>
        )}

        {/* AI 智能速报/舆情脉络卡片 */}
        {summaryOpen && (
          <TrendingSummaryCard
            summary={summaryData?.summary || ''}
            loading={summaryLoading}
            cached={summaryData?.cached}
            updatedAt={summaryData?.updatedAt}
            sampleCount={summaryData?.sampleCount || 35}
            dateLabel={availableDates.find((d) => d.date === selectedDate)?.label || selectedDate}
            isHistorical={selectedDate !== 'today'}
            onRefresh={() => fetchSummary(selectedDate, true)}
            onClose={() => setSummaryOpen(false)}
            onTalkToAgent={(customPrompt) => {
              const prompt = customPrompt.startsWith('根据这份') || customPrompt.startsWith('参考这份')
                ? customPrompt
                : `这是【${selectedDate === 'today' ? '今日实时' : selectedDate}】全网热点情报总结：\n\n${customPrompt}\n\n请针对以上热点脉络，发表你的深度独到见解！`;
              setSelectedTopic({
                id: 'ai-summary',
                source: 'all',
                sourceName: 'AI 全网热点脉络',
                title: `${selectedDate === 'today' ? '今日' : selectedDate} 全网舆情总览`,
                url: '',
                desc: prompt,
              });
              setAgentModalOpen(true);
            }}
            onDiscussInSpace={(content) => {
              const prompt = `【${selectedDate === 'today' ? '今日' : selectedDate} 全网热点情报速递】\n${content}\n\n大家怎么看今天全网的这几个舆论风向？欢迎各抒己见讨论！`;
              router.push(`/spaces?initialTopic=${encodeURIComponent(prompt)}`);
            }}
          />
        )}

        {/* 1. 大分类导航条 (5大专区 + ⭐ 我的收藏) */}
        <div className="mb-4 flex gap-2 overflow-x-auto scrollbar-none pb-1">
          {TRENDING_CATEGORIES.map((cat) => {
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => handleCategoryChange(cat.id)}
                className={`flex shrink-0 items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-black transition ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-md shadow-slate-900/10 dark:bg-white dark:text-slate-900'
                    : 'bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300'
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.name}</span>
              </button>
            );
          })}

          {/* ⭐ 我的收藏 Tab */}
          <button
            onClick={() => handleCategoryChange('favorites')}
            className={`flex shrink-0 items-center gap-1.5 rounded-2xl px-4 py-2.5 text-xs font-black transition ${
              activeCategory === 'favorites'
                ? 'bg-amber-500 text-white shadow-md shadow-amber-500/20'
                : 'bg-white text-slate-600 border border-slate-200/80 hover:bg-slate-50 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300'
            }`}
          >
            <Star
              size={13}
              className={activeCategory === 'favorites' ? 'fill-white text-white' : 'text-amber-500 fill-amber-500'}
            />
            <span>我的收藏</span>
            {favoritesList.length > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                  activeCategory === 'favorites'
                    ? 'bg-white/20 text-white'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300'
                }`}
              >
                {favoritesList.length}
              </span>
            )}
          </button>
        </div>

        {/* 2. 细分平台选择与搜索条（收藏模式下隐藏平台选择） */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
          {activeCategory === 'favorites' ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                ⭐ 我的收藏夹 ({filteredFavorites.length} 条热点)
              </span>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto scrollbar-none pb-1">
              <button
                onClick={() => setActiveSource('all')}
                className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                  activeSource === 'all'
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                <span>{activeCategory === 'all' ? '全部平台' : '专区全部'}</span>
                <span className="rounded-full bg-black/10 px-1.5 py-0.2 text-[10px] dark:bg-white/10">
                  {categoryFiltered.length} 平台
                </span>
              </button>
              {categoryFiltered.map((src) => {
                const isSourceRefreshing = Boolean(refreshingSources[src.source]);
                return (
                  <button
                    key={src.source}
                    onClick={() => setActiveSource(src.source)}
                    className={`flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                      activeSource === src.source
                        ? 'bg-amber-500 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    <span>{src.sourceName}</span>
                    {isSourceRefreshing ? (
                      <RefreshCw size={10} className="animate-spin text-white" />
                    ) : (
                      <span className="rounded-full bg-black/10 px-1.5 py-0.2 text-[10px] dark:bg-white/10">
                        {src.items.length}条
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Search box */}
          <div className="relative w-full sm:w-60 shrink-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索热点话题..."
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs font-medium text-slate-800 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-900 dark:text-white"
            />
          </div>
        </div>

        {/* Content Body */}
        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3">
            <LoadingSpinner />
            <p className="text-xs font-semibold text-slate-400">正在装载全网实时热榜...</p>
          </div>
        ) : activeCategory === 'favorites' ? (
          /* 收藏模式视图 */
          filteredFavorites.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center dark:border-slate-800 dark:bg-slate-900/20">
              <Star size={28} className="text-amber-400/60 stroke-1 mb-1" />
              <p className="text-sm font-bold text-slate-600 dark:text-slate-300">暂无收藏的热搜话题</p>
              <p className="text-xs text-slate-400">
                浏览热点或历史时光机时，点击卡片右下角的「⭐ 收藏」即可永久留存！
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3">
              {filteredFavorites.map((fav) => {
                const hotItem: HotItem = {
                  id: fav.itemId,
                  source: fav.source,
                  sourceName: fav.sourceName,
                  title: fav.title,
                  url: fav.url,
                  heat: fav.heat || undefined,
                  desc: fav.desc || undefined,
                  category: fav.category || undefined,
                };
                const cleanDesc = fav.desc ? fav.desc.replace(/\[图片\]/g, '').replace(/\[视频\]/g, '').trim() : '';
                const itemKey = `${fav.source}:${fav.itemId || fav.title}`;
                const isRead = readKeys.has(itemKey);

                return (
                  <div
                    key={fav.id}
                    className="group relative flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:border-amber-400 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/90 dark:hover:border-amber-500/40"
                  >
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          <span className="flex h-6 px-2 shrink-0 items-center justify-center rounded-lg text-[10px] font-black bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                            {fav.sourceName}
                          </span>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm leading-snug line-clamp-2">
                              {fav.url ? (
                                <a
                                  href={fav.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={() => markAsRead(itemKey)}
                                  className={`transition hover:text-amber-600 hover:underline dark:hover:text-amber-400 ${
                                    isRead
                                      ? 'text-slate-400 dark:text-slate-500 font-medium'
                                      : 'text-slate-900 dark:text-slate-100 font-bold'
                                  }`}
                                  title="点击直接打开原文"
                                >
                                  {fav.title}
                                </a>
                              ) : (
                                <span className={isRead ? 'text-slate-400 dark:text-slate-500 font-medium' : 'text-slate-900 dark:text-slate-100 font-bold'}>
                                  {fav.title}
                                </span>
                              )}
                            </h4>
                            {cleanDesc ? (
                              <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400 line-clamp-2">
                                {cleanDesc}
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Card Bottom Bar */}
                    <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800/80">
                      <span className="font-bold text-amber-600 dark:text-amber-400 text-xs whitespace-nowrap shrink-0">
                        {fav.heat ? `🔥 ${fav.heat}` : '⭐ 已收藏'}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => toggleFavorite(hotItem, { source: fav.source, sourceName: fav.sourceName })}
                          className="flex h-7 w-7 items-center justify-center rounded-xl bg-amber-100 text-amber-700 hover:bg-amber-200 transition dark:bg-amber-900/60 dark:text-amber-300"
                          title="取消收藏"
                        >
                          <Star size={13} className="fill-amber-500 text-amber-500" />
                        </button>
                        <button
                          onClick={() => handleTalkToAgent(hotItem, fav.category || undefined)}
                          className="flex h-7 w-7 items-center justify-center rounded-xl bg-amber-50 text-amber-700 hover:bg-amber-100 transition dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/60"
                          title="选角色 AI 锐评此话题"
                        >
                          <Bot size={14} />
                        </button>
                        <button
                          onClick={() => handleDiscussInSpace(hotItem)}
                          className="flex h-7 w-7 items-center justify-center rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition dark:bg-slate-800 dark:text-slate-200"
                          title="投喂到空间引发智能体群聊"
                        >
                          <PanelsTopLeft size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : filteredSources.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center dark:border-slate-800 dark:bg-slate-900/20">
            <p className="text-sm font-bold text-slate-500">该分类下暂无热搜话题或正在刷新中</p>
            <p className="text-xs text-slate-400">
              {selectedDate === 'today' ? '点击右上角「实时刷新」获取最新数据' : '当前历史归档无该源数据'}
            </p>
          </div>
        ) : filteredSources.length === 1 ? (
          /* Single Platform Spread-Out View (单个平台铺开全屏) */
          <div className="flex flex-col gap-4">
            {/* Single Platform Sub-Header */}
            <div className="flex items-center justify-between px-1 py-0.5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 text-base dark:bg-amber-500/20">
                  {filteredSources[0].icon || '🔥'}
                </span>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-black text-slate-900 dark:text-white">
                    {filteredSources[0].sourceName}
                  </h2>
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                    TOP {filteredSources[0].items.length} 热榜
                  </span>
                  {refreshing ? (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 animate-pulse">
                      <RefreshCw size={11} className="animate-spin" />
                      正在连接官方接口同步最新...
                    </span>
                  ) : (
                    <span className="hidden sm:inline-block text-xs text-slate-400">
                      · {selectedDate === 'today' ? `${formatTimeAgo(filteredSources[0].updatedAt)}更新` : '终盘归档快照'}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveSource('all')}
                  className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-amber-600 dark:text-slate-400 dark:hover:text-amber-400 transition"
                >
                  <span>← 返回全平台对比</span>
                </button>
              </div>
            </div>

            {/* Spread-out Hot Items Grid (3 columns on desktop) */}
            <div
              className={`grid grid-cols-1 gap-3.5 md:grid-cols-2 lg:grid-cols-3 transition-opacity duration-200 ${
                refreshing ? 'opacity-50 pointer-events-none' : 'opacity-100'
              }`}
            >
              {filteredSources[0].items.map((item, idx) => {
                const rank = idx + 1;
                const isTop3 = rank <= 3;
                const cleanDesc = item.desc ? item.desc.replace(/\[图片\]/g, '').replace(/\[视频\]/g, '').trim() : '';
                const itemKey = `${filteredSources[0].source}:${item.id || item.title}`;
                const isFav = favoriteKeys.has(itemKey);
                const isRead = readKeys.has(itemKey);

                return (
                  <div
                    key={item.id || idx}
                    className="group relative flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm transition hover:border-amber-400 hover:shadow-md dark:border-slate-800 dark:bg-slate-900/90 dark:hover:border-amber-500/40"
                  >
                    <div className="flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          <span
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs font-black ${
                              isTop3
                                ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm'
                                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {rank}
                          </span>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm leading-snug line-clamp-2">
                              {item.url ? (
                                <a
                                  href={item.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={() => markAsRead(itemKey)}
                                  className={`transition hover:text-amber-600 hover:underline dark:hover:text-amber-400 ${
                                    isRead
                                      ? 'text-slate-400 dark:text-slate-500 font-medium'
                                      : 'text-slate-900 dark:text-slate-100 font-bold'
                                  }`}
                                  title="点击直接打开原文"
                                >
                                  {item.title}
                                </a>
                              ) : (
                                <span className={isRead ? 'text-slate-400 dark:text-slate-500 font-medium' : 'text-slate-900 dark:text-slate-100 font-bold'}>
                                  {item.title}
                                </span>
                              )}
                            </h4>
                            {cleanDesc ? (
                              <p className="mt-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400 line-clamp-2">
                                {cleanDesc}
                              </p>
                            ) : null}
                          </div>
                        </div>

                        {item.thumbnail && (
                          <a
                            href={item.url || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => markAsRead(itemKey)}
                            className="relative shrink-0 overflow-hidden rounded-xl border border-slate-200/60 bg-slate-100 dark:border-slate-800 dark:bg-slate-800 group/thumb"
                            title="查看原文封面"
                          >
                            <img
                              src={item.thumbnail}
                              alt={item.title}
                              loading="lazy"
                              className="h-14 w-14 object-cover transition-transform duration-300 group-hover/thumb:scale-105"
                              onError={(e) => {
                                (e.currentTarget.parentElement as HTMLElement).style.display = 'none';
                              }}
                            />
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Card Bottom Bar */}
                    <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800/80">
                      <span className="font-bold text-amber-600 dark:text-amber-400 text-xs whitespace-nowrap shrink-0">
                        {item.heat && `🔥 ${item.heat}`}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() =>
                            toggleFavorite(item, {
                              source: filteredSources[0].source,
                              sourceName: filteredSources[0].sourceName,
                              category: filteredSources[0].category,
                            })
                          }
                          className={`flex h-7 w-7 items-center justify-center rounded-xl transition ${
                            isFav
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300'
                              : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400'
                          }`}
                          title={isFav ? '取消收藏' : '收藏此热点'}
                        >
                          <Star size={13} className={isFav ? 'fill-amber-500 text-amber-500' : ''} />
                        </button>
                        <button
                          onClick={() => handleTalkToAgent(item, filteredSources[0].category)}
                          className="flex h-7 w-7 items-center justify-center rounded-xl bg-amber-50 text-amber-700 hover:bg-amber-100 transition dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/60"
                          title="选角色 AI 锐评此话题"
                        >
                          <Bot size={14} />
                        </button>
                        <button
                          onClick={() => handleDiscussInSpace(item)}
                          className="flex h-7 w-7 items-center justify-center rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 transition dark:bg-slate-800 dark:text-slate-200"
                          title="投喂到空间引发智能体群聊"
                        >
                          <PanelsTopLeft size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Multi-Board Grid (多个看板并排) */
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredSources.map((src) => (
              <div
                key={src.source}
                className="flex flex-col rounded-3xl border border-slate-100 bg-slate-50/50 p-4 shadow-sm dark:border-slate-800/80 dark:bg-slate-900/40"
              >
                {/* Board Header */}
                <div className="mb-4 flex items-center justify-between border-b border-slate-200/60 pb-3 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-black text-slate-900 dark:text-white">
                      {src.sourceName}
                    </h3>
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400">
                      TOP {src.items.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-slate-400">
                      {selectedDate === 'today' ? formatTimeAgo(src.updatedAt) : '历史归档'}
                    </span>
                    {selectedDate === 'today' && (
                      <button
                        onClick={() => refreshSingleSource(src.source)}
                        disabled={Boolean(refreshingSources[src.source])}
                        title={`仅刷新 ${src.sourceName}`}
                        className="flex h-6 w-6 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
                      >
                        <RefreshCw
                          size={11}
                          className={refreshingSources[src.source] ? 'animate-spin text-amber-500' : ''}
                        />
                      </button>
                    )}
                  </div>
                </div>

                {/* Items */}
                <div className="flex flex-col gap-2.5 overflow-y-auto max-h-[680px] pr-1">
                  {src.items.map((item, idx) => {
                    const rank = idx + 1;
                    const isTop3 = rank <= 3;
                    const cleanDesc = item.desc ? item.desc.replace(/\[图片\]/g, '').replace(/\[视频\]/g, '').trim() : '';
                    const itemKey = `${src.source}:${item.id || item.title}`;
                    const isFav = favoriteKeys.has(itemKey);
                    const isRead = readKeys.has(itemKey);

                    return (
                      <div
                        key={item.id || idx}
                        className="group relative flex flex-col justify-between gap-2 rounded-2xl border border-slate-200/80 bg-white p-3.5 shadow-sm transition hover:border-amber-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-800/90 dark:hover:border-amber-500/30"
                      >
                        <div className="flex items-start justify-between gap-2.5">
                          <div className="flex items-start gap-2 min-w-0 flex-1">
                            <span
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-black ${
                                isTop3
                                  ? 'bg-gradient-to-br from-amber-400 to-orange-500 text-white'
                                  : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {rank}
                            </span>
                            <div className="flex-1 min-w-0">
                              <h4 className="text-xs leading-snug line-clamp-2">
                                {item.url ? (
                                  <a
                                    href={item.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => markAsRead(itemKey)}
                                    className={`transition hover:text-amber-600 hover:underline dark:hover:text-amber-400 ${
                                      isRead
                                        ? 'text-slate-400 dark:text-slate-500 font-medium'
                                        : 'text-slate-900 dark:text-slate-100 font-bold'
                                    }`}
                                    title="点击直接打开原文"
                                  >
                                    {item.title}
                                  </a>
                                ) : (
                                  <span className={isRead ? 'text-slate-400 dark:text-slate-500 font-medium' : 'text-slate-900 dark:text-slate-100 font-bold'}>
                                    {item.title}
                                  </span>
                                )}
                              </h4>
                              {cleanDesc ? (
                                <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 line-clamp-2">
                                  {cleanDesc}
                                </p>
                              ) : null}
                            </div>
                          </div>

                          {item.thumbnail && (
                            <a
                              href={item.url || '#'}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={() => markAsRead(itemKey)}
                              className="relative shrink-0 overflow-hidden rounded-lg border border-slate-200/60 bg-slate-100 dark:border-slate-800 dark:bg-slate-800 group/thumb"
                              title="查看原文封面"
                            >
                              <img
                                src={item.thumbnail}
                                alt={item.title}
                                loading="lazy"
                                className="h-11 w-11 object-cover transition-transform duration-300 group-hover/thumb:scale-105"
                                onError={(e) => {
                                  (e.currentTarget.parentElement as HTMLElement).style.display = 'none';
                                }}
                              />
                            </a>
                          )}
                        </div>

                        {/* Card bottom bar */}
                        <div className="flex items-center justify-between gap-2 border-t border-slate-50 pt-2 text-[11px] dark:border-slate-800/60">
                          <span className="font-bold text-amber-600 dark:text-amber-400 text-[10px] whitespace-nowrap shrink-0">
                            {item.heat && `🔥 ${item.heat}`}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() =>
                                toggleFavorite(item, {
                                  source: src.source,
                                  sourceName: src.sourceName,
                                  category: src.category,
                                })
                              }
                              className={`flex h-6 w-6 items-center justify-center rounded-lg transition ${
                                isFav
                                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300'
                                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-400'
                              }`}
                              title={isFav ? '取消收藏' : '收藏此热点'}
                            >
                              <Star size={12} className={isFav ? 'fill-amber-500 text-amber-500' : ''} />
                            </button>
                            <button
                              onClick={() => handleTalkToAgent(item, src.category)}
                              className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 transition dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-900/60"
                              title="选角色 AI 锐评此话题"
                            >
                              <Bot size={13} />
                            </button>
                            <button
                              onClick={() => handleDiscussInSpace(item)}
                              className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition dark:bg-slate-700 dark:text-slate-200"
                              title="投喂到空间引发智能体群聊"
                            >
                              <PanelsTopLeft size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 选 Agent 弹窗 (赛道精准匹配 + 全员搭子) */}
        {agentModalOpen && selectedTopic && (() => {
          const domainKey = getDomainKey(selectedTopic.category, selectedTopic.source);
          const domainInfo = DOMAIN_AGENT_MAP[domainKey] || DOMAIN_AGENT_MAP['hot'];
          const displayAgents = agentModalTab === 'domain'
            ? domainInfo.agents
            : GAMING_AGENTS.map((g) => ({
                id: g.id,
                name: g.name,
                avatar: g.avatar || '🤖',
                tag: g.tone || '搭子',
                description: g.description,
              }));

          return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm animate-in fade-in">
              <div className="flex w-full max-w-lg flex-col rounded-3xl bg-white p-5 sm:p-6 shadow-2xl dark:bg-slate-900 border border-slate-100 dark:border-slate-800 max-h-[90vh]">
                {/* Modal Header */}
                <div className="flex items-center justify-between mb-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500 dark:bg-amber-500/20">
                      <Sparkles size={18} />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">选择哪位角色为你锐评？</h3>
                      <p className="text-[11px] text-slate-400">已根据所属赛道智能推荐最匹配的分析角色</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setAgentModalOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition"
                  >
                    ✕
                  </button>
                </div>

                {/* Selected Topic Bar */}
                <div className="mb-3.5 rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800/80">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold text-slate-400">选中的热搜话题：</span>
                    <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
                      {selectedTopic.sourceName} {selectedTopic.heat ? `· 🔥 ${selectedTopic.heat}` : ''}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-100 line-clamp-2">
                    {selectedTopic.title}
                  </p>
                </div>

                {/* Tabs: 赛道专属专家 vs 全员开黑搭子 */}
                <div className="flex items-center gap-2 mb-3 border-b border-slate-100 dark:border-slate-800 pb-2.5">
                  <button
                    onClick={() => setAgentModalTab('domain')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                      agentModalTab === 'domain'
                        ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/20'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    <span>{domainInfo.icon}</span>
                    <span>{domainInfo.domainName}专家</span>
                    <span className="rounded-full bg-black/10 dark:bg-white/20 px-1.5 py-0.2 text-[10px]">
                      {domainInfo.agents.length}
                    </span>
                  </button>
                  <button
                    onClick={() => setAgentModalTab('all')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                      agentModalTab === 'all'
                        ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/20'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    <span>🎮</span>
                    <span>全员开黑搭子</span>
                    <span className="rounded-full bg-black/10 dark:bg-white/20 px-1.5 py-0.2 text-[10px]">
                      {GAMING_AGENTS.length}
                    </span>
                  </button>
                </div>

                {/* Agent List */}
                <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
                  {displayAgents.map((agent) => (
                    <button
                      key={agent.id}
                      onClick={() => startChatWithAgent(agent.id)}
                      className="group flex items-center gap-3 rounded-2xl border border-slate-100 p-2.5 text-left transition hover:border-amber-300 hover:bg-amber-50/50 dark:border-slate-800 dark:hover:border-amber-500/30 dark:hover:bg-slate-800"
                    >
                      <span className="text-2xl shrink-0 group-hover:scale-110 transition-transform">
                        {agent.avatar}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-900 dark:text-white">
                            {agent.name}
                          </span>
                          {agent.tag && (
                            <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                              {agent.tag}
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">
                          {agent.description}
                        </div>
                      </div>
                      <span className="text-xs text-amber-600 dark:text-amber-400 font-bold shrink-0 flex items-center gap-0.5 group-hover:translate-x-0.5 transition-transform">
                        锐评 →
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* 全链路网络与本地代理体检弹窗 */}
        <NetworkDiagnosticModal
          isOpen={networkModalOpen}
          onClose={() => setNetworkModalOpen(false)}
        />
      </div>
    </AppShell>
  );
}
