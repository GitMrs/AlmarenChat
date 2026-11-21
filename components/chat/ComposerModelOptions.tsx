'use client';

import { Brain, Check, Cloud, Cpu } from 'lucide-react';
import { cn } from '@/lib/client/utils';
import type { BrowserModelSource } from '@/lib/web/browser-model';

type Props = {
  deepThinking: boolean;
  onToggleThinking: () => void;
  thinkingDisabled?: boolean;
  modelSource?: BrowserModelSource;
  onModelSourceChange?: (source: BrowserModelSource) => void;
};

const modelOptions = [
  { source: 'ONLINE', label: '线上模型', Icon: Cloud },
  { source: 'OLLAMA', label: '本地模型', Icon: Cpu },
] as const;

const optionClass = 'flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-black transition disabled:opacity-40';
const inactiveClass = 'text-slate-600 hover:bg-slate-50 hover:text-slate-950';
const activeClass = 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100';

export default function ComposerModelOptions({
  deepThinking,
  onToggleThinking,
  thinkingDisabled,
  modelSource,
  onModelSourceChange,
}: Props) {
  return (
    <>
      {onModelSourceChange && (
        <div role="group" aria-label="模型来源">
          {modelOptions.map(({ source, label, Icon }) => (
            <button
              key={source}
              type="button"
              aria-pressed={source === modelSource}
              onClick={() => onModelSourceChange(source)}
              className={cn(optionClass, source === modelSource ? activeClass : inactiveClass)}
            >
              <Icon size={16} />
              <span className="flex-1">{label}</span>
              {source === modelSource && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        aria-pressed={deepThinking}
        onClick={onToggleThinking}
        disabled={thinkingDisabled}
        title="开启后用于当前聊天的后续消息，直到手动关闭"
        className={cn(optionClass, deepThinking ? activeClass : inactiveClass)}
      >
        <Brain size={16} />
        <span className="flex-1">深度思考</span>
        {deepThinking && <Check size={14} />}
      </button>
    </>
  );
}
