'use client';

import { Brain, Check, Cloud, Cpu } from 'lucide-react';
import { cn } from '@/lib/client/utils';
import type { BrowserModelSource } from '@/lib/web/browser-model';

type Props = {
  deepThinking: boolean;
  onToggleThinking: () => void;
  thinkingDisabled?: boolean;
};

const modelOptions = [
  { source: 'ONLINE', label: '线上', Icon: Cloud },
  { source: 'OLLAMA', label: '本地', Icon: Cpu },
] as const;

export function ComposerModelSourceSwitch({
  modelSource,
  onModelSourceChange,
  disabled,
}: {
  modelSource: BrowserModelSource;
  onModelSourceChange: (source: BrowserModelSource) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label="模型来源" className="inline-flex shrink-0 items-center rounded-lg bg-slate-100 p-0.5 text-[11px] font-bold">
      {modelOptions.map(({ source, label, Icon }) => (
        <button
          key={source}
          type="button"
          aria-label={label + '模型'}
          aria-pressed={source === modelSource}
          onClick={() => onModelSourceChange(source)}
          disabled={disabled}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-md px-2.5 transition disabled:cursor-not-allowed disabled:opacity-60',
            source === modelSource ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-950'
          )}
        >
          <Icon size={12} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

const optionClass = 'flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-black transition disabled:opacity-40';
const inactiveClass = 'text-slate-600 hover:bg-slate-50 hover:text-slate-950';
const activeClass = 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100';

export default function ComposerModelOptions({
  deepThinking,
  onToggleThinking,
  thinkingDisabled,
}: Props) {
  return (
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
  );
}
