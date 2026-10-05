export interface NormalizedHotItem {
  id: string;              // 唯一标识 (如 'zhihu-2089736714', 'bilibili-BV1...')
  source: string;          // 平台标识
  sourceName: string;      // 平台中文名
  title: string;           // 标题
  url: string;             // 原文链接
  heat?: string;           // 热度描述 (如 "695万", "百万播放", "452万")
  desc?: string;           // 摘要或正文描述
  thumbnail?: string;      // 封面/缩略图
  extra?: Record<string, any>;
}

export type TrendingCategory = 'hot' | 'tech' | 'anime' | 'dev' | 'culture' | 'crypto' | 'general';

export interface TrendingSourceConfig {
  id: string;
  name: string;
  category: TrendingCategory;
  categoryName: string;
  icon: string;
  url: string;
  type: 'zhihu' | '36kr' | 'bilibili' | 'baidu' | 'weibo' | 'toutiao' | 'dailyhot' | 'rss' | 'binance' | 'okx' | 'blockbeats' | 'foresight';
  description: string;
  enabled?: boolean;
}

export interface TrendingSnapshot {
  source: string;
  sourceName: string;
  category?: TrendingCategory;
  categoryName?: string;
  icon?: string;
  updatedAt: string;
  total: number;
  items: NormalizedHotItem[];
}
