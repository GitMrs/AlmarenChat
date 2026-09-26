'use client';

import React, { useMemo } from 'react';
import { Loader2, Square, Volume2 } from 'lucide-react';
import { useTTS } from '@/hooks/useTTS';
import SearchableSelect, { SearchableSelectOption } from '@/components/shared/SearchableSelect';
import { CURATED_VOICES, DEFAULT_VOICE_ID, getVoiceById } from '@/lib/tts/voices.mjs';
import { cn } from '@/lib/utils';

interface AgentVoicePickerProps {
  value: string;
  onChange: (voiceId: string) => void;
  className?: string;
  size?: 'sm' | 'md';
}

const PREVIEW_TEXTS: Record<string, string> = {
  'zh-CN-XiaoyiNeural': '你好呀！我是晓伊，今天你想和我聊些什么呢？',
  'zh-CN-YunxiNeural': '你好！我是云希，准备好开始今天的合作了吗？',
  'zh-CN-XiaoxiaoNeural': '您好，我是晓晓。很高兴陪伴在您的身边。',
  'zh-TW-HsiaoChenNeural': '哈喽！我是晓臻，很高兴认识你，今天也要开开心心的喔！',
  'zh-CN-YunjianNeural': '你好，我是云健。请告诉我你的任务，我们按步骤推进。',
  'zh-CN-YunxiaNeural': '哈喽！我是云夏，元气满满的一天开始啦！',
  'zh-CN-YunyangNeural': '各位好，我是云扬。为您播报最新的动态与分析。',
  'zh-CN-liaoning-XiaobeiNeural': '哎妈呀老铁！我是晓北，今天想唠点啥嗑啊？',
  'en-US-JennyNeural': 'Hello! I am Jenny, ready to help you with your daily tasks.',
  'en-US-GuyNeural': 'Hi there, I am Guy. Let us focus and achieve your goals together.',
};

export default function AgentVoicePicker({
  value,
  onChange,
  className,
  size = 'sm',
}: AgentVoicePickerProps) {
  const { play, stop, isPlaying, isLoading, currentId } = useTTS();
  const selectedVoiceId = value || DEFAULT_VOICE_ID;
  const currentVoice = getVoiceById(selectedVoiceId);

  const previewId = `preview-${selectedVoiceId}`;
  const isVoicePlaying = isPlaying && currentId === previewId;
  const isVoiceLoading = isLoading && currentId === previewId;

  const handleTogglePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (isVoicePlaying || isVoiceLoading) {
      stop();
      return;
    }
    const previewText = PREVIEW_TEXTS[selectedVoiceId] || `你好，我是${currentVoice.name}。`;
    play(previewText, { id: previewId, voice: selectedVoiceId });
  };

  const isSmall = size === 'sm';

  const voiceOptions: SearchableSelectOption[] = useMemo(
    () =>
      CURATED_VOICES.map((v) => ({
        value: v.id,
        label: `${v.name} (${v.gender === 'Female' ? '女' : '男'})`,
        description: v.description,
        badge: v.tags[0],
      })),
    []
  );

  return (
    <div className={cn('inline-flex items-center gap-1.5', className)}>
      {/* 封装好的 SearchableSelect 下拉组件 */}
      <SearchableSelect
        value={selectedVoiceId}
        options={voiceOptions}
        placeholder="选择声线"
        searchPlaceholder="搜索声线..."
        compact={isSmall}
        triggerClassName={cn(
          'rounded-full border-indigo-200/90 bg-indigo-50/70 font-bold text-indigo-950 hover:bg-indigo-50 focus:border-indigo-400 focus:ring-indigo-100',
          isSmall ? 'h-7 px-2.5 text-2xs' : 'h-9 px-3 text-xs'
        )}
        dropdownClassName="w-72"
        showSearch={false}
        onChange={(newVoiceId) => {
          if (isVoicePlaying || isVoiceLoading) {
            stop();
          }
          onChange(newVoiceId);
        }}
      />

      {/* 试听 / 停止播放按钮 */}
      <button
        type="button"
        onClick={handleTogglePreview}
        className={cn(
          'inline-flex items-center justify-center gap-1 rounded-full border font-bold transition shrink-0',
          isVoicePlaying
            ? 'border-indigo-500 bg-indigo-600 text-white shadow-xs'
            : 'border-indigo-200/90 bg-white text-indigo-700 hover:border-indigo-300 hover:bg-indigo-50 active:scale-95',
          isSmall ? 'h-7 px-2 text-2xs' : 'h-9 px-3 text-xs'
        )}
        title={isVoicePlaying ? '停止试听' : `试听 ${currentVoice.name} 声线`}
        aria-label="试听声线"
      >
        {isVoiceLoading ? (
          <Loader2 size={isSmall ? 10 : 12} className="animate-spin text-indigo-600" />
        ) : isVoicePlaying ? (
          <Square size={isSmall ? 8 : 10} className="fill-current text-white" />
        ) : (
          <Volume2 size={isSmall ? 11 : 13} className="text-indigo-600" />
        )}
        <span>{isVoicePlaying ? '停止' : '试听'}</span>
      </button>
    </div>
  );
}
