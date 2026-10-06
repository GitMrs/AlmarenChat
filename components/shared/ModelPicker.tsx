'use client';

import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import SearchableSelect from './SearchableSelect';
import { user as userApi } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface ModelPickerPreset {
  label: string;
  value: string;
  desc?: string;
}

export interface ModelPickerProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  apiBaseUrl?: string;
  apiKey?: string;
  label?: React.ReactNode;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  actionText?: string;
  compact?: boolean;
  disabled?: boolean;
  quickPresets?: ModelPickerPreset[];
  className?: string;
  onFetchSuccess?: (models: string[]) => void;
}

/**
 * 封装通用 AI 模型选择器组件（与个人中心模型获取组件体验完全一致）
 * - 支持根据 Base URL / API Key 一键「获取全部」在线模型
 * - 支持 SearchableSelect 实时检索与下拉选择
 * - 支持通过 actionText / 按钮随时在「选择列表」与「手动输入」之间自由切换
 * - 支持可选的快捷预设 Chips
 */
export default function ModelPicker({
  id = 'model-picker',
  value,
  onChange,
  apiBaseUrl = '',
  apiKey = '',
  label = '模型名称',
  placeholder = '例如 deepseek-chat、gpt-4o',
  searchPlaceholder = '搜索模型...',
  emptyText = '没有匹配的模型',
  actionText = '手动填写其他模型',
  compact = false,
  disabled = false,
  quickPresets,
  className,
  onFetchSuccess,
}: ModelPickerProps) {
  const [fetchingModels, setFetchingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [manualModelEntry, setManualModelEntry] = useState(false);
  const [modelListResult, setModelListResult] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const handleFetchModels = async () => {
    if (fetchingModels || disabled) return;
    setFetchingModels(true);
    setModelListResult(null);
    try {
      const result = await userApi.models({
        apiBaseUrl: apiBaseUrl.trim(),
        apiKey: apiKey.trim(),
      });
      const models = result.models || [];
      setAvailableModels(models);
      if (models.length > 0) {
        setManualModelEntry(false);
        setModelListResult({
          type: 'success',
          message: `已获取 ${models.length} 个模型`,
        });
        onFetchSuccess?.(models);
      } else {
        setModelListResult({
          type: 'error',
          message: '服务返回的模型列表为空',
        });
      }
    } catch (err: any) {
      setAvailableModels([]);
      setModelListResult({
        type: 'error',
        message: err.message || '获取模型列表失败，请检查配置',
      });
    } finally {
      setFetchingModels(false);
    }
  };

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between gap-3">
        {typeof label === 'string' ? (
          <label htmlFor={id} className={cn('font-bold text-slate-700', compact ? 'text-xs' : 'text-sm')}>
            {label}
          </label>
        ) : (
          label
        )}
        <div className="flex items-center gap-2">
          {availableModels.length > 0 && manualModelEntry && (
            <button
              type="button"
              onClick={() => setManualModelEntry(false)}
              className={cn(
                'inline-flex cursor-pointer items-center justify-center rounded-lg font-bold text-indigo-600 transition hover:bg-indigo-50 hover:text-indigo-800',
                compact ? 'h-7 px-2 text-[11px]' : 'h-8 px-2.5 text-xs'
              )}
            >
              从列表选择
            </button>
          )}
          <button
            type="button"
            onClick={handleFetchModels}
            disabled={fetchingModels || disabled}
            className={cn(
              'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg font-bold transition',
              compact ? 'h-7 px-2.5 text-[11px]' : 'h-8 px-3 text-xs font-black',
              fetchingModels
                ? 'bg-slate-100 text-slate-400'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            )}
            title="拉取当前端点支持的模型列表"
          >
            <RefreshCw className={fetchingModels ? 'animate-spin' : ''} size={compact ? 11 : 13} />
            {fetchingModels ? '获取中...' : '获取全部'}
          </button>
        </div>
      </div>

      {availableModels.length > 0 && !manualModelEntry ? (
        <SearchableSelect
          id={id}
          value={value}
          options={availableModels}
          placeholder={placeholder || '请选择模型'}
          searchPlaceholder={searchPlaceholder}
          emptyText={emptyText}
          actionText={actionText}
          disabled={disabled}
          compact={compact}
          onChange={onChange}
          onAction={() => setManualModelEntry(true)}
        />
      ) : (
        <div className="space-y-2">
          <input
            id={id}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(
              'w-full border border-black/[0.08] font-medium text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500',
              compact
                ? 'h-10 rounded-xl bg-white px-3.5 text-xs'
                : 'h-12 rounded-2xl bg-[#fbfaf7] px-4 text-sm focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70'
            )}
          />

          {quickPresets && quickPresets.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {quickPresets.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  onClick={() => onChange(preset.value)}
                  className={cn(
                    'cursor-pointer rounded-lg px-2.5 py-1 text-[11px] font-bold transition',
                    value === preset.value
                      ? 'bg-indigo-600 text-white shadow-2xs'
                      : 'border border-black/[0.06] bg-[#fbfaf7] text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  )}
                  title={preset.desc ? `${preset.desc} (${preset.value})` : preset.value}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {modelListResult && (
        <p
          className={cn(
            'text-xs font-semibold leading-5',
            modelListResult.type === 'success' ? 'text-emerald-600' : 'text-rose-600'
          )}
        >
          {modelListResult.message}
          {modelListResult.type === 'success' && availableModels.length > 0 && !manualModelEntry
            ? '，请从下拉列表选择。'
            : ''}
        </p>
      )}
    </div>
  );
}
