'use client';

import { Compass, Crosshair, Eye, Lightbulb, MapPin, Scroll, Sparkles, Target, X } from 'lucide-react';
import Avatar from '@/components/shared/Avatar';
import { CATEGORY_COLORS } from '@/types';
import type { DisplayAgent } from '@/components/chat/ChatMessageItem';

type PlayContextPanelProps = {
  displayAgent: DisplayAgent;
  categoryColor: string;
  isOpen: boolean;
  onClose: () => void;
  messageCount: number;
};

const CATEGORY_SCENE: Record<string, string> = {
  悬疑推理: '案件现场',
  浪漫言情: '邂逅时刻',
  奇幻冒险: '冒险起点',
  都市剧情: '城市街头',
  社交推理: '讨论大厅',
  心理博弈: '博弈空间',
  喜剧搞笑: '欢乐舞台',
  恐怖惊悚: '未知深处',
  科幻探索: '星际航站',
};

const CATEGORY_OBJECTIVE: Record<string, string> = {
  悬疑推理: '收集线索，推理真相',
  浪漫言情: '了解角色，推进关系',
  奇幻冒险: '探索世界，完成任务',
  都市剧情: '做出选择，书写人生',
  社交推理: '找出真相，投票决策',
  心理博弈: '分析局势，制定策略',
  喜剧搞笑: '放飞想象，享受欢乐',
  恐怖惊悚: '保持冷静，活着离开',
  科幻探索: '发现未知，记录探索',
};

const CATEGORY_ACTIONS: Record<string, string[]> = {
  悬疑推理: ['检查现场', '审问嫌疑人', '分析线索', '提出推理'],
  浪漫言情: ['打招呼', '了解背景', '表达关心', '邀请同行'],
  奇幻冒险: ['探索前方', '查看物品', '与NPC对话', '发起战斗'],
  都市剧情: ['观察环境', '主动搭话', '做出决定', '回顾选择'],
  社交推理: ['发言陈述', '提出质疑', '查看证据', '发起投票'],
  心理博弈: ['试探对方', '表明立场', '提出交易', '分析心理'],
  喜剧搞笑: ['讲个笑话', '来个反转', '吐槽一下', '角色扮演'],
  恐怖惊悚: ['小心前进', '查看四周', '躲在暗处', '大声呼救'],
  科幻探索: ['扫描环境', '读取数据', '尝试沟通', '启动设备'],
};

export default function PlayContextPanel({
  displayAgent,
  categoryColor,
  isOpen,
  onClose,
  messageCount,
}: PlayContextPanelProps) {
  if (!isOpen) return null;

  const category = displayAgent.category || '都市剧情';
  const scene = CATEGORY_SCENE[category] || '故事空间';
  const objective = CATEGORY_OBJECTIVE[category] || '探索故事，做出选择';
  const actions = CATEGORY_ACTIONS[category] || ['探索', '对话', '观察', '行动'];

  return (
    <div className="fixed inset-0 z-50 lg:relative lg:z-auto">
      {/* Mobile overlay */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm lg:hidden" onClick={onClose} />

      <div className="absolute right-0 top-0 flex h-full w-[300px] flex-col border-l border-white/10 bg-[#19172a]/95 backdrop-blur-xl lg:relative lg:w-[280px]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <Compass size={16} style={{ color: categoryColor }} />
            <span className="text-sm font-black text-white">冒险面板</span>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-white/[0.08]">
            <X size={16} className="text-white/40" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {/* Current Scene */}
          <div className="rounded-2xl bg-white/[0.06] p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-white/40">
              <MapPin size={13} style={{ color: categoryColor }} />
              当前场景
            </div>
            <p className="text-sm font-black text-white">{scene}</p>
            <p className="mt-1 text-xs text-white/54">{displayAgent.description || '故事正在展开...'}</p>
          </div>

          {/* Player Identity */}
          <div className="rounded-2xl bg-white/[0.06] p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-white/40">
              <Eye size={13} style={{ color: categoryColor }} />
              你的身份
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.08] text-lg">
                🎭
              </div>
              <div>
                <p className="text-sm font-black text-white">冒险者</p>
                <p className="text-xs text-white/54">{category}世界探索者</p>
              </div>
            </div>
          </div>

          {/* Current Objective */}
          <div className="rounded-2xl bg-white/[0.06] p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-white/40">
              <Target size={13} style={{ color: categoryColor }} />
              当前目标
            </div>
            <p className="text-sm font-bold text-white/70">{objective}</p>
          </div>

          {/* Story Progress */}
          <div className="rounded-2xl bg-white/[0.06] p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-white/40">
              <Scroll size={13} style={{ color: categoryColor }} />
              故事进度
            </div>
            <div className="flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    backgroundColor: categoryColor,
                    width: `${Math.min(100, Math.max(5, (messageCount / 20) * 100))}%`,
                  }}
                />
              </div>
              <span className="text-xs font-bold text-white/54">{messageCount} 条</span>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="rounded-2xl bg-white/[0.06] p-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-bold text-white/40">
              <Lightbulb size={13} style={{ color: categoryColor }} />
              快捷行动
            </div>
            <div className="flex flex-wrap gap-2">
              {actions.map((action) => (
                <span
                  key={action}
                  className="rounded-full bg-white/[0.08] px-3 py-1.5 text-xs font-bold text-white/64"
                >
                  {action}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-white/10 p-4">
          <div className="flex items-center gap-2 rounded-2xl p-3" style={{ backgroundColor: `${categoryColor}15` }}>
            <Sparkles size={14} style={{ color: categoryColor }} />
            <p className="text-xs font-bold" style={{ color: categoryColor }}>
              {category} · {displayAgent.tone || '沉浸'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
