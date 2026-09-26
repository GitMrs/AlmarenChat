'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SearchableSelectOption = {
  value: string;
  label?: string;
  description?: string;
  badge?: string;
};

export type SelectItem = string | SearchableSelectOption;

export type SearchableSelectProps = {
  id?: string;
  value: string;
  options: SelectItem[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  actionText?: string;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  triggerClassName?: string;
  dropdownClassName?: string;
  showSearch?: boolean;
  onChange: (value: string) => void;
  onAction?: () => void;
};

interface NormalizedOption {
  value: string;
  label: string;
  description?: string;
  badge?: string;
}

export default function SearchableSelect({
  id,
  value,
  options,
  placeholder = '请选择',
  searchPlaceholder = '搜索选项',
  emptyText = '没有匹配的选项',
  actionText,
  disabled = false,
  compact = false,
  className,
  triggerClassName,
  dropdownClassName,
  showSearch,
  onChange,
  onAction,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const normalizedOptions: NormalizedOption[] = useMemo(() => {
    const list = options.map((opt) => {
      if (typeof opt === 'string') {
        return { value: opt, label: opt };
      }
      return {
        value: opt.value,
        label: opt.label || opt.value,
        description: opt.description,
        badge: opt.badge,
      };
    });

    if (value && !list.some((item) => item.value === value)) {
      list.unshift({ value, label: value });
    }
    return list;
  }, [options, value]);

  const selectedOption = useMemo(
    () => normalizedOptions.find((opt) => opt.value === value),
    [normalizedOptions, value]
  );

  const filteredOptions = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    if (!keyword) return normalizedOptions;
    return normalizedOptions.filter(
      (opt) =>
        opt.label.toLocaleLowerCase().includes(keyword) ||
        opt.value.toLocaleLowerCase().includes(keyword) ||
        (opt.description && opt.description.toLocaleLowerCase().includes(keyword))
    );
  }, [normalizedOptions, query]);

  const shouldDisplaySearch = showSearch !== undefined ? showSearch : normalizedOptions.length > 5;

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const displayText = selectedOption?.label || value || placeholder;

  return (
    <div ref={rootRef} className={cn('relative min-w-0', className)}>
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setQuery('');
          setOpen((current) => !current);
        }}
        className={cn(
          'flex w-full items-center gap-2 border border-black/[0.08] text-left text-sm font-semibold text-slate-800 outline-none transition',
          'hover:border-black/[0.14] focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70',
          'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400',
          compact ? 'h-9 rounded-xl bg-white px-3 text-xs' : 'h-12 rounded-2xl bg-[#fbfaf7] px-4',
          triggerClassName
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !value && 'text-slate-400')}>{displayText}</span>
        <span
          className={cn(
            'flex items-center justify-center shrink-0 text-slate-400 transition',
            compact ? 'h-5 w-5 rounded-md text-xs' : 'h-7 w-7 rounded-lg bg-white shadow-sm ring-1 ring-black/[0.04]',
            open && 'text-slate-700'
          )}
        >
          <ChevronDown size={compact ? 12 : 15} className={cn('transition-transform duration-200', open && 'rotate-180')} />
        </span>
      </button>

      {open && (
        <div
          className={cn(
            'absolute left-0 top-full z-50 mt-1.5 min-w-[220px] max-w-[340px] overflow-hidden rounded-2xl border border-black/[0.08] bg-white p-2 shadow-[0_18px_50px_rgba(15,23,42,0.16)]',
            dropdownClassName
          )}
        >
          {shouldDisplaySearch && (
            <div className="flex h-9 items-center gap-2 rounded-xl bg-slate-50 px-2.5 text-slate-400 mb-1.5">
              <Search size={14} />
              <input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-xs font-medium text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>
          )}

          <div role="listbox" className="max-h-60 space-y-1 overflow-y-auto overscroll-contain pr-1">
            {filteredOptions.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(option.value);
                    close();
                  }}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition',
                    isSelected ? 'bg-slate-950 text-white' : 'text-slate-700 hover:bg-slate-50'
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={cn('text-xs font-bold truncate', isSelected ? 'text-white' : 'text-slate-800')}>
                        {option.label}
                      </span>
                      {option.badge && (
                        <span
                          className={cn(
                            'rounded-full px-1.5 py-0.2 text-[10px] font-bold shrink-0',
                            isSelected ? 'bg-white/20 text-white' : 'bg-indigo-50 text-indigo-700'
                          )}
                        >
                          {option.badge}
                        </span>
                      )}
                    </div>
                    {option.description && (
                      <p
                        className={cn(
                          'mt-0.5 line-clamp-1 text-[11px] leading-tight',
                          isSelected ? 'text-slate-300' : 'text-slate-400'
                        )}
                      >
                        {option.description}
                      </p>
                    )}
                  </div>
                  {isSelected && <Check size={14} className="shrink-0 mt-0.5 text-white" />}
                </button>
              );
            })}

            {filteredOptions.length === 0 && (
              <div className="px-3 py-4 text-center text-xs font-semibold text-slate-400">{emptyText}</div>
            )}
          </div>

          {actionText && onAction && (
            <button
              type="button"
              onClick={() => {
                close();
                onAction();
              }}
              className="mt-1.5 flex h-9 w-full items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs font-bold text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700"
            >
              {actionText}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
