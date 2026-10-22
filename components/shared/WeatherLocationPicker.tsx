'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, Loader2, MapPin, Search, X } from 'lucide-react';
import { weather } from '@/lib/client/api';
import { cn } from '@/lib/client/utils';
import type { WeatherLocation } from '@/types/weather';

export const weatherLocationLabel = (location: WeatherLocation) => [...new Set([location.country, location.province, location.city, location.name].filter(Boolean))].join(' · ');

type Props = {
  value: WeatherLocation | null;
  loading?: boolean;
  error?: string;
  autoOpen?: boolean;
  onOpen?: () => void;
  onChange: (location: WeatherLocation | null) => Promise<void>;
};

export default function WeatherLocationPicker({ value, loading = false, error = '', autoOpen = false, onOpen, onChange }: Props) {
  const [open, setOpen] = useState(autoOpen);
  const [query, setQuery] = useState('');
  const [locations, setLocations] = useState<WeatherLocation[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searched, setSearched] = useState(false);
  const [above, setAbove] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  const mounted = useRef(true);
  const savingRef = useRef(false);
  const dialogId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; version.current++; };
  }, []);

  function close(focus = false) {
    version.current++;
    setSearching(false);
    setOpen(false);
    if (focus) requestAnimationFrame(() => { if (mounted.current) trigger.current?.focus(); });
  }

  useEffect(() => {
    if (!open) return;
    const rect = root.current?.getBoundingClientRect();
    if (rect) setAbove(window.innerHeight - rect.bottom < 300 && rect.top > window.innerHeight - rect.bottom);
    input.current?.focus();
    const outside = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(true); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  async function search() {
    if (!query.trim() || searching || savingRef.current || loading) return;
    const current = ++version.current;
    setSearching(true);
    setSearchError('');
    setLocations([]);
    setSearched(false);
    try {
      const result = await weather.locations(query.trim());
      if (!mounted.current || current !== version.current) return;
      setLocations(result.locations);
      setSearched(true);
    } catch (cause: any) {
      if (mounted.current && current === version.current) setSearchError(cause.message || '地点查询失败');
    } finally {
      if (mounted.current && current === version.current) setSearching(false);
    }
  }

  async function select(location: WeatherLocation | null) {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSearchError('');
    try {
      await onChange(location);
      if (!mounted.current) return;
      setQuery('');
      setLocations([]);
      setSearched(false);
      close(root.current?.contains(document.activeElement));
    } catch (cause: any) {
      if (mounted.current) setSearchError(cause.message || '保存失败，请重试');
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <div ref={root} className={cn('relative min-w-0', open && 'z-50')}>
      <button ref={trigger} type="button" aria-label={value ? `修改天气地点：${weatherLocationLabel(value)}` : '设置天气地点'} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? dialogId : undefined} disabled={loading || saving} onClick={() => {
        if (open) { close(); return; }
        setSearchError('');
        setOpen(true);
        onOpen?.();
      }} title={value ? weatherLocationLabel(value) : '设置账号默认天气地点'} className="flex max-w-full items-center gap-1 rounded-xl px-2 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800">
        {loading || saving ? <Loader2 size={13} className="shrink-0 animate-spin" /> : <MapPin size={13} className="shrink-0 text-sky-500" />}
        <span className="max-w-44 truncate">{loading ? '读取中…' : value ? [...new Set([value.city, value.name].filter(Boolean))].join(' · ') : '选择地点'}</span>
        <ChevronDown size={12} className="shrink-0" />
      </button>
      {open && <div id={dialogId} role="dialog" aria-label="选择默认天气地点" className={cn('absolute right-0 z-50 w-80 max-w-[calc(100vw-3rem)] rounded-2xl border border-slate-200 bg-white p-3.5 text-xs shadow-xl dark:border-slate-700 dark:bg-slate-900', above ? 'bottom-full mb-2' : 'top-full mt-2')}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="font-bold text-slate-900 dark:text-white">默认天气地点</span>
          <button type="button" onClick={() => close(true)} aria-label="关闭地点选择" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X size={14} /></button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void search(); }} className="flex gap-2">
          <input ref={input} aria-label="城市或区县" placeholder="搜索城市或区县" maxLength={100} value={query} disabled={saving} onChange={(event) => {
            version.current++;
            setQuery(event.target.value);
            setSearching(false);
            setLocations([]);
            setSearched(false);
            setSearchError('');
          }} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-transparent px-3 py-2 text-slate-700 outline-none focus:border-sky-500 dark:border-slate-700 dark:text-slate-200" />
          <button type="submit" disabled={!query.trim() || searching || saving || loading} aria-label="搜索地点" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sky-600 text-white disabled:opacity-40">{searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}</button>
        </form>
        {(searchError || error) && <p role="alert" className="mt-2 text-rose-600 dark:text-rose-400">{searchError || error}</p>}
        {searching && <p role="status" className="mt-2 text-slate-500">正在查找地点…</p>}
        {searched && !locations.length && <p role="status" className="mt-2 text-slate-500">未找到地点，请补充城市或区县名称</p>}
        <div className="mt-2 max-h-52 space-y-1 overflow-y-auto">
          {locations.map((location) => <button key={location.id} type="button" disabled={saving} onClick={() => void select(location)} className="block w-full rounded-xl px-2.5 py-2 text-left hover:bg-sky-50 disabled:opacity-40 dark:hover:bg-slate-800">
            <span className="block font-semibold text-slate-900 dark:text-white">{location.name}{location.id === value?.id ? ' · 当前' : ''}</span>
            <span className="mt-0.5 block text-[11px] text-slate-400">{weatherLocationLabel(location)}</span>
          </button>)}
        </div>
        <div className="mt-2 flex items-start justify-between gap-3 border-t border-slate-100 pt-2 text-[11px] text-slate-400 dark:border-slate-800">
          <span role="status">{saving ? '正在保存…' : '选中即保存，热榜与聊天共用。'}</span>
          {value && <button type="button" disabled={saving || searching} onClick={() => void select(null)} className="shrink-0 hover:text-slate-600 disabled:opacity-40 dark:hover:text-slate-200">清除</button>}
        </div>
      </div>}
      {!open && error && <span role="alert" className="text-xs text-rose-600">{error}</span>}
    </div>
  );
}
