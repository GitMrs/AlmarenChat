'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { ArrowLeft, MessageCircle, Heart, Sparkles, Zap, BookOpen, Code, Heart as HeartIcon, Palette, Wrench, Coffee, Gamepad2 } from 'lucide-react';
import Avatar from '@/components/shared/Avatar';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { getBuiltInAgents } from '@/lib/agents-data';
import { cn } from '@/lib/utils';
import { CATEGORY_COLORS } from '@/types';
import type { Agent } from '@/types';

const CATEGORY_CAPABILITIES: Record<string, { icon: typeof Zap; items: string[] }> = {
  '写作': { icon: BookOpen, items: ['文章撰写', '文案润色', '创意写作', '内容策划'] },
  '编程': { icon: Code, items: ['代码编写', 'Bug 调试', '架构设计', '代码审查'] },
  '学习': { icon: BookOpen, items: ['知识讲解', '学习规划', '概念解析', '考试辅导'] },
  '心理': { icon: HeartIcon, items: ['情绪疏导', '压力管理', '自我认知', '正念练习'] },
  '创意': { icon: Palette, items: ['创意构思', '头脑风暴', '方案设计', '灵感激发'] },
  '生活': { icon: Coffee, items: ['生活建议', '健康管理', '旅行规划', '美食推荐'] },
  '工具': { icon: Wrench, items: ['效率提升', '数据处理', '文档编写', '自动化'] },
  '娱乐': { icon: Gamepad2, items: ['游戏推荐', '影视点评', '趣味问答', '冷知识'] },
};

const CATEGORY_SUGGESTIONS: Record<string, (name: string) => string[]> = {
  '写作': (name) => [`帮我想一个${name}主题的文章大纲`, '帮我润色这段文字', '写一首关于春天的诗'],
  '编程': (name) => [`${name}，帮我写一个快速排序`, '解释一下 React Hooks', '帮我优化这段代码'],
  '学习': (name) => [`${name}，用简单例子解释量子力学`, '帮我制定学习计划', '总结这个概念的要点'],
  '心理': (name) => [`${name}，我最近压力很大`, '帮我做一次放松练习', '如何培养积极心态？'],
  '创意': (name) => [`${name}，帮我想一个创意方案`, '设计一个独特 logo 概念', '给我一个创业灵感'],
  '生活': (name) => [`${name}，推荐一周健康食谱`, '帮我规划一次旅行', '如何养成早起习惯？'],
  '工具': (name) => [`${name}，帮我写一个正则表达式`, '推荐好用的效率工具', '帮我分析这组数据'],
  '娱乐': (name) => [`${name}，推荐几部好电影`, '讲一个有趣的冷知识', '来个脑筋急转弯'],
};

export default function AgentDetailPage() {
  const router = useRouter();
  const params = useParams();
  const agentId = params.agentId as string;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFavorited, setIsFavorited] = useState(false);

  useEffect(() => {
    getBuiltInAgents().then((agents) => {
      const found = agents.find((a) => a.id === agentId);
      setAgent(found || null);
      setLoading(false);
    });
  }, [agentId]);

  const capabilities = useMemo(() => {
    if (!agent) return null;
    return CATEGORY_CAPABILITIES[agent.category || ''] || {
      icon: Zap,
      items: ['智能对话', '问题解答', '知识分享', '任务协助'],
    };
  }, [agent]);

  const suggestedPrompts = useMemo(() => {
    if (!agent) return [];
    const generator = CATEGORY_SUGGESTIONS[agent.category || ''];
    return generator ? generator(agent.name) : ['你能帮我做什么？', '给我讲讲你的特长', '来试试吧'];
  }, [agent]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-gray-500">Agent 不存在</p>
        <button
          onClick={() => router.push('/')}
          className="px-4 py-2 bg-primary-600 text-white rounded-xl text-sm"
        >
          返回首页
        </button>
      </div>
    );
  }

  const categoryColor = CATEGORY_COLORS[agent.category || ''] || '#6366f1';
  const CapIcon = capabilities?.icon || Zap;

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-100">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-full hover:bg-gray-100 transition-colors"
        >
          <ArrowLeft size={20} className="text-gray-600" />
        </button>
        <h1 className="text-lg font-semibold text-gray-900">Agent 详情</h1>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Hero */}
        <div className="relative bg-white px-6 py-8">
          <div
            className="absolute top-0 left-0 right-0 h-32 opacity-10"
            style={{ backgroundColor: categoryColor }}
          />
          <div
            className="absolute top-0 right-0 w-40 h-40 rounded-full opacity-[0.06] blur-3xl"
            style={{ backgroundColor: categoryColor }}
          />

          <div className="relative flex flex-col items-center text-center">
            <Avatar src={agent.avatar} alt={agent.name} size="xl" className="mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">{agent.name}</h2>

            <div className="flex items-center gap-2 mb-4">
              <span
                className="px-3 py-1 rounded-full text-sm font-medium text-white"
                style={{ backgroundColor: categoryColor }}
              >
                {agent.category}
              </span>
              {agent.tone && (
                <span className="px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-gray-600">
                  {agent.tone}
                </span>
              )}
            </div>

            <p className="text-gray-600 max-w-md">{agent.description}</p>
          </div>
        </div>

        {/* Capabilities */}
        {capabilities && (
          <div className="mx-6 mt-4 p-4 bg-white rounded-2xl border border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              <CapIcon size={16} style={{ color: categoryColor }} />
              <span className="text-sm font-semibold text-gray-700">擅长领域</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {capabilities.items.map((item) => (
                <span
                  key={item}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border"
                  style={{
                    backgroundColor: `${categoryColor}08`,
                    borderColor: `${categoryColor}20`,
                    color: categoryColor,
                  }}
                >
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Greeting Preview */}
        {agent.greeting && (
          <div className="mx-6 mt-4 p-4 bg-white rounded-2xl border border-gray-100">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={16} className="text-primary-600" />
              <span className="text-sm font-semibold text-gray-700">开场白</span>
            </div>
            <p className="text-sm text-gray-600 italic">&ldquo;{agent.greeting}&rdquo;</p>
          </div>
        )}

        {/* Suggested Prompts */}
        <div className="mx-6 mt-4 p-4 bg-white rounded-2xl border border-gray-100">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">试试这样问</h3>
          <div className="flex flex-wrap gap-2">
            {suggestedPrompts.map((prompt, i) => (
              <button
                key={i}
                onClick={() => router.push(`/chat/${agent.id}?prompt=${encodeURIComponent(prompt)}`)}
                className="px-3 py-2 bg-gray-50 rounded-xl text-sm text-gray-600 hover:bg-primary-50 hover:text-primary-700 transition-colors border border-gray-100"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="px-6 py-6 flex gap-3">
          <button
            onClick={() => router.push(`/chat/${agent.id}`)}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-primary-600 text-white rounded-2xl font-medium hover:bg-primary-700 transition-colors"
          >
            <MessageCircle size={20} />
            开始聊天
          </button>
          <button
            onClick={() => setIsFavorited(!isFavorited)}
            className={cn(
              'px-4 py-3 rounded-2xl border transition-colors',
              isFavorited
                ? 'bg-red-50 border-red-200 text-red-500'
                : 'bg-white border-gray-200 text-gray-500 hover:border-red-200 hover:text-red-400'
            )}
          >
            <Heart size={20} fill={isFavorited ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
    </div>
  );
}
