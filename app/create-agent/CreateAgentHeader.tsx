import { RefreshCw, Wand2 } from 'lucide-react';
import type { CreationType } from './types';

type CreateAgentHeaderProps = {
  editingAgentId: string | null;
  creationType: CreationType | null;
  onReset: () => void;
  onChooseAgain: () => void;
};

export default function CreateAgentHeader({
  editingAgentId,
  creationType,
  onReset,
  onChooseAgain,
}: CreateAgentHeaderProps) {
  return (
    <section className="mb-8 rounded-[32px] border border-white/10 bg-[#19172a] p-6 backdrop-blur sm:p-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/[0.08] px-4 py-2 text-sm font-bold text-white/82 backdrop-blur">
            <Wand2 size={16} className="text-[#d89022]" />
            {editingAgentId ? '体验编辑器' : '体验创作器'}
          </div>
          <h1 className="text-4xl font-black leading-tight text-white sm:text-5xl">
            {editingAgentId ? '继续打磨你的体验。' : '创造一个可玩的故事体验。'}
          </h1>
          <p className="mt-4 text-base leading-7 text-white/58">
            {editingAgentId
              ? '修改设定、内容和开场白。保存后会更新你的体验。'
              : '选择类型，填写内容。每个部分都可以手动填写或让 AI 提供建议。'}
          </p>
        </div>
        {creationType && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onReset}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-4 py-2 text-sm font-bold text-white/70 transition hover:bg-white/[0.12]"
            >
              <RefreshCw size={14} />
              重置
            </button>
            <button
              onClick={onChooseAgain}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.08] px-4 py-2 text-sm font-bold text-white/70 transition hover:bg-white/[0.12]"
            >
              <RefreshCw size={14} />
              重新选择类型
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
