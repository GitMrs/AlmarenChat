import { Sparkles } from 'lucide-react';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { cn } from '@/lib/utils';
import { MYSTERY_SECTIONS } from './constants';

type MysterySectionTabsProps = {
  activeTab: string;
  generatingSection: string | null;
  canGenerateSection: (sectionId: string) => boolean;
  onTabChange: (sectionId: string) => void;
  onGenerate: (sectionId: string) => void;
};

export default function MysterySectionTabs({
  activeTab,
  generatingSection,
  canGenerateSection,
  onTabChange,
  onGenerate,
}: MysterySectionTabsProps) {
  const activeSection = MYSTERY_SECTIONS.find((section) => section.id === activeTab);
  const isGenerating = generatingSection === activeTab;
  const canGenerate = canGenerateSection(activeTab);

  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {MYSTERY_SECTIONS.map((section) => {
          const isActive = activeTab === section.id;
          return (
            <button
              key={section.id}
              onClick={() => onTabChange(section.id)}
              className={cn(
                'flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold whitespace-nowrap transition',
                isActive
                  ? 'bg-white text-[#19172a] shadow-sm'
                  : 'bg-white/[0.08] text-white/54 hover:bg-white/[0.12]'
              )}
            >
              <span style={{ color: isActive ? section.color : undefined }}>{section.icon}</span>
              {section.title}
            </button>
          );
        })}
      </div>

      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-2xl"
            style={{ backgroundColor: `${activeSection?.color}20`, color: activeSection?.color }}
          >
            {activeSection?.icon}
          </div>
          <h2 className="text-xl font-black text-white">{activeSection?.title}</h2>
        </div>
        <button
          onClick={() => onGenerate(activeTab)}
          disabled={isGenerating || !canGenerate}
          className={cn(
            'flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold transition',
            isGenerating || !canGenerate
              ? 'bg-white/[0.08] text-white/30'
              : 'bg-white/[0.08] text-white/64 hover:bg-white/[0.12]'
          )}
        >
          {isGenerating ? (
            <>
              <LoadingSpinner size="sm" />
              生成中
            </>
          ) : (
            <>
              <Sparkles size={14} />
              AI 建议
            </>
          )}
        </button>
      </div>
    </>
  );
}
