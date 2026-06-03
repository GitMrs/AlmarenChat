import { CREATION_TYPES } from './constants';
import type { CreationType } from './types';

type UnsupportedCreationTypePanelProps = {
  creationType: CreationType | null;
  onBack: () => void;
};

export default function UnsupportedCreationTypePanel({
  creationType,
  onBack,
}: UnsupportedCreationTypePanelProps) {
  if (!creationType || creationType === 'mystery' || creationType === 'character') {
    return null;
  }

  const option = CREATION_TYPES.find((item) => item.id === creationType);

  return (
    <div className="rounded-[32px] border border-dashed border-white/18 bg-white/[0.04] p-12 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-3xl bg-white/[0.08] text-3xl">
        {option?.icon}
      </div>
      <h3 className="mb-2 text-xl font-black text-white">{option?.name} 创作器</h3>
      <p className="mb-6 text-sm text-white/54">
        此类型的创作器正在开发中。你可以使用基础字段手动创建。
      </p>
      <button
        onClick={onBack}
        className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-[#19172a] transition hover:-translate-y-0.5 hover:shadow-lg"
      >
        返回选择
      </button>
    </div>
  );
}
