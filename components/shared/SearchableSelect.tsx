'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

type SearchableSelectProps = {
  id?: string;
  value: string;
  options: string[];
  placeholder: string;
  searchPlaceholder?: string;
  emptyText?: string;
  actionText?: string;
  disabled?: boolean;
  compact?: boolean;
  onChange: (value: string) => void;
  onAction?: () => void;
};

export default function SearchableSelect({
  id,
  value,
  options,
  placeholder,
  searchPlaceholder = '搜索选项',
  emptyText = '没有匹配的选项',
  actionText,
  disabled = false,
  compact = false,
  onChange,
  onAction,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const normalizedOptions = useMemo(
    () => Array.from(new Set(value && !options.includes(value) ? [value, ...options] : options)),
    [options, value]
  );
  const filteredOptions = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return keyword
      ? normalizedOptions.filter((option) => option.toLocaleLowerCase().includes(keyword))
      : normalizedOptions;
  }, [normalizedOptions, query]);

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

  return (
    <div ref={rootRef} className="relative min-w-0">
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
          'flex w-full items-center gap-3 border border-black/[0.08] text-left text-sm font-semibold text-slate-800 outline-none transition',
          'hover:border-black/[0.14] focus:border-slate-300 focus:ring-4 focus:ring-slate-200/70',
          'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400',
          compact ? 'h-11 rounded-xl bg-white px-3' : 'h-12 rounded-2xl bg-[#fbfaf7] px-4'
        )}
      >
        <span className={cn('min-w-0 flex-1 truncate', !value && 'text-slate-400')}>{value || placeholder}</span>
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white text-slate-400 shadow-sm ring-1 ring-black/[0.04] transition',
            compact && 'bg-slate-50',
            open && 'text-slate-700'
          )}
        >
          <ChevronDown size={15} className={cn('transition-transform duration-200', open && 'rotate-180')} />
        </span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-40 mt-2 overflow-hidden rounded-2xl border border-black/[0.08] bg-white p-2 shadow-[0_18px_50px_rgba(15,23,42,0.16)]">
          <div className="flex h-10 items-center gap-2 rounded-xl bg-slate-50 px-3 text-slate-400">
            <Search size={15} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
            />
          </div>
          <div role="listbox" className="mt-2 max-h-60 space-y-1 overflow-y-auto overscroll-contain pr-1">
            {filteredOptions.map((option) => (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={option === value}
                onClick={() => {
                  onChange(option);
                  close();
                }}
                className={cn(
                  'flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm font-semibold transition',
                  option === value ? 'bg-slate-950 text-white' : 'text-slate-700 hover:bg-slate-50'
                )}
              >
                <span className="min-w-0 flex-1 break-all">{option}</span>
                {option === value && <Check size={15} className="shrink-0" />}
              </button>
            ))}
            {filteredOptions.length === 0 && (
              <div className="px-3 py-6 text-center text-xs font-semibold text-slate-400">{emptyText}</div>
            )}
          </div>
          {actionText && onAction && (
            <button
              type="button"
              onClick={() => {
                close();
                onAction();
              }}
              className="mt-2 flex h-10 w-full items-center justify-center rounded-xl border border-dashed border-slate-200 text-xs font-black text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700"
            >
              {actionText}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
