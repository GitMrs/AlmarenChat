'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Cloud, CloudRain, CloudSnow, Droplets, MapPin, RefreshCw, Search, Sun, Thermometer, Wind, X } from 'lucide-react';
import styles from './TrendingWeather.module.css';

const STORAGE_KEY = 'almaren_trending_weather_location';

interface WeatherLocation {
  id: string;
  name: string;
  city?: string;
  province?: string;
  country?: string;
  timezone?: string;
}

interface WeatherData {
  source: string;
  link?: string;
  location: WeatherLocation;
  observations: { temp: string; text: string; feelsLike?: string; obsTime: string; windDir?: string; windScale?: string; humidity?: string };
}

function weatherPage(link?: string) {
  try {
    const url = new URL(link || '');
    if (url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'qweather.com' || url.hostname.endsWith('.qweather.com'))) return url.href;
  } catch { /* Missing links do not prevent viewing the weather. */ }
  return null;
}

function regionLabel(location: WeatherLocation) {
  return [...new Set([location.country, location.province, location.city, location.name].filter(Boolean))].join(' · ');
}

async function weatherRequest(params: Record<string, string>, signal: AbortSignal) {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('请先登录后查询天气');
  const response = await fetch(`/api/weather?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` }, signal, cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(response.status === 401 ? '请重新登录后查询天气' : result.error || '天气查询失败');
  return result;
}

export default function TrendingWeather() {
  const [location, setLocation] = useState<WeatherLocation | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [locations, setLocations] = useState<WeatherLocation[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const detailsTrigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const weatherController = useRef<AbortController | null>(null);
  const searchController = useRef<AbortController | null>(null);

  const loadWeather = useCallback(async (target: WeatherLocation, clear = false) => {
    weatherController.current?.abort();
    const controller = new AbortController();
    weatherController.current = controller;
    if (clear) setWeather(null);
    setLoading(true);
    setError('');
    try {
      const result = await weatherRequest({ location: target.id, kind: 'now' }, controller.signal);
      if (controller.signal.aborted) return;
      if (!result.observations || result.observations.temp == null || !Number.isFinite(Number(result.observations.temp))) {
        throw new Error('暂时没有有效的实况温度');
      }
      setWeather(result);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '天气查询失败');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved.id === 'string' && saved.id.length <= 100 && typeof saved.name === 'string') {
        setLocation(saved);
        void loadWeather(saved);
      }
    } catch { /* A missing or unavailable local preference does not block the page. */ }
    return () => { weatherController.current?.abort(); searchController.current?.abort(); };
  }, [loadWeather]);

  useEffect(() => {
    if (!open && !detailsOpen) return;
    if (open) input.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) { setOpen(false); setDetailsOpen(false); }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false); setDetailsOpen(false);
        (open ? trigger : detailsTrigger).current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, detailsOpen]);

  const findLocations = async () => {
    if (!search.trim() || searching) return;
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    setSearching(true);
    setSearchError('');
    setLocations([]);
    try {
      const result = await weatherRequest({ location: search.trim(), kind: 'locations' }, controller.signal);
      if (controller.signal.aborted) return;
      setLocations(result.locations || []);
      if (!result.locations?.length) setSearchError('未找到地区，请补充城市或区县名称');
    } catch (reason) {
      if (!controller.signal.aborted) setSearchError(reason instanceof Error ? reason.message : '地区查询失败');
    } finally {
      if (!controller.signal.aborted) setSearching(false);
    }
  };

  const selectLocation = (next: WeatherLocation) => {
    setLocation(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Selection still works without persistent storage. */ }
    setOpen(false);
    trigger.current?.focus();
    void loadWeather(next, true);
  };

  const condition = weather?.observations.text || '';
  const WeatherIcon = /雪/.test(condition) ? CloudSnow : /雨/.test(condition) ? CloudRain : /晴/.test(condition) ? Sun : Cloud;
  const scene = /雪/.test(condition) ? 'snow' : /雨/.test(condition) ? 'rain' : /晴/.test(condition) ? 'sun' : 'cloud';
  const forecastLink = weatherPage(weather?.link);
  let observationTime = '';
  if (weather?.observations.obsTime && !Number.isNaN(Date.parse(weather.observations.obsTime))) {
    observationTime = new Date(weather.observations.obsTime).toLocaleTimeString('zh-CN', {
      hour: '2-digit', minute: '2-digit', timeZone: weather.location.timezone || 'Asia/Shanghai',
    });
  }

  return (
    <div ref={container} className="relative min-w-0 text-xs text-slate-600 dark:text-slate-300">
      <div className="flex min-h-8 flex-wrap items-center justify-end gap-x-2 gap-y-1">
        <button ref={trigger} type="button" onClick={() => { setOpen(!open); setDetailsOpen(false); }} aria-expanded={open} aria-controls="trending-weather-regions"
          title={location ? `${regionLabel(location)}，切换地区` : '选择天气地区'}
          className="flex min-w-0 max-w-40 items-center gap-1 rounded px-1 py-1.5 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800">
          <MapPin size={13} className="shrink-0 text-sky-500" />
          <span className="truncate">{location?.name || '选择地区'}</span>
        </button>
        {location && (
          <button ref={detailsTrigger} type="button" onClick={() => { setDetailsOpen(!detailsOpen); setOpen(false); }} aria-label="查看天气详情" aria-expanded={detailsOpen} aria-controls="trending-weather-details"
            className="flex min-h-8 items-center gap-1.5 rounded px-1 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
            title={weather ? `查看天气详情${observationTime ? ` · ${observationTime} 观测` : ''}` : '查看天气详情'}>
            <WeatherIcon size={16} className={`text-sky-500${loading ? ' animate-spin' : ''}`} />
            {weather ? <><span>{condition}</span><span className="font-semibold text-slate-900 dark:text-white">{weather.observations.temp}℃</span></> : <span>{loading ? '查询中' : '暂无数据'}</span>}
          </button>
        )}
      </div>
      {error && <p role="alert" className="max-w-sm text-right text-[11px] text-rose-600 dark:text-rose-400">{error}{weather ? '（显示上次数据）' : ''}</p>}
      {detailsOpen && location && (
        <div id="trending-weather-details" role="dialog" aria-label="天气详情"
          className={`${styles.panel} ${styles[scene]} absolute right-0 top-full z-40 mt-2 w-[360px] max-w-[calc(100vw-3rem)] overflow-hidden rounded-lg border border-white/60 p-5 text-slate-900 shadow-xl`}>
          <div className={styles.scene} aria-hidden="true">
            {scene === 'sun' && <Sun className={styles.sunlight} size={150} strokeWidth={1} />}
            {(scene === 'cloud' || scene === 'rain') && <><Cloud className={styles.cloudOne} size={140} strokeWidth={0.8} /><Cloud className={styles.cloudTwo} size={95} strokeWidth={0.8} /></>}
            {(scene === 'rain' || scene === 'snow') && Array.from({ length: 12 }, (_, i) => <i key={i} className={scene === 'rain' ? styles.raindrop : styles.snowflake} style={{ left: `${5 + i * 8}%`, animationDelay: `${-i * 0.47}s`, animationDuration: `${scene === 'rain' ? 1.1 + i % 3 * 0.2 : 4 + i % 3}s` }} />)}
          </div>
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><div className="truncate text-base font-semibold" title={regionLabel(location)}>{location.name}</div><div className="mt-1 text-[11px] text-slate-600">{weather?.source || '和风天气'}</div></div>
              <button type="button" onClick={() => { setDetailsOpen(false); detailsTrigger.current?.focus(); }} aria-label="关闭天气详情" title="关闭天气详情" className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-white/40"><X size={16} /></button>
            </div>
            {weather ? <>
              <div className="mb-6 mt-7 flex items-end gap-3">
                <span className="text-6xl font-light leading-none">{weather.observations.temp}<span className="align-top text-2xl">℃</span></span>
                <span className="mb-1 flex items-center gap-1.5 text-sm"><WeatherIcon size={19} />{condition}</span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-3 border-t border-slate-600/15 pt-4 text-xs">
                <span className="flex items-center gap-1.5"><Thermometer size={15} />体感 {weather.observations.feelsLike ?? '--'}℃</span>
                <span className="flex items-center gap-1.5"><Droplets size={15} />湿度 {weather.observations.humidity != null ? `${weather.observations.humidity}%` : '--'}</span>
                <span className="col-span-2 flex items-center gap-1.5"><Wind size={15} />{weather.observations.windDir || '风向暂无'}{weather.observations.windScale != null ? ` ${weather.observations.windScale}级` : ''}</span>
              </div>
            </> : <p role="status" className="py-8 text-sm">{loading ? '正在查询天气…' : '暂时没有天气数据'}</p>}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-600/15 pt-3">
              {forecastLink ? <a href={forecastLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs hover:underline">近七天天气<ArrowUpRight size={13} /></a> : <span />}
              <button type="button" onClick={() => void loadWeather(location)} disabled={loading} aria-label="刷新天气" title={observationTime ? `${observationTime} 观测 · 点击刷新（5 分钟缓存）` : '刷新天气'} className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/40 disabled:opacity-50"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
            </div>
          </div>
        </div>
      )}
      {open && (
        <div id="trending-weather-regions" role="dialog" aria-label="选择天气地区"
          className="absolute right-0 top-full z-40 mt-2 w-80 max-w-[calc(100vw-3rem)] rounded-lg border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-slate-900 dark:text-white">天气地区</span>
            <button type="button" onClick={() => { setOpen(false); trigger.current?.focus(); }} title="关闭地区选择" aria-label="关闭地区选择"
              className="flex h-7 w-7 items-center justify-center rounded hover:bg-slate-100 dark:hover:bg-slate-800"><X size={14} /></button>
          </div>
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void findLocations(); }}>
            <input ref={input} type="search" aria-label="城市或区县" placeholder="城市或区县" maxLength={100} value={search}
              onChange={(event) => { searchController.current?.abort(); setSearching(false); setSearch(event.target.value); setLocations([]); setSearchError(''); }}
              className="min-w-0 flex-1 rounded border border-slate-200 bg-transparent px-2.5 py-2 outline-none focus:border-sky-500 dark:border-slate-700" />
            <button type="submit" disabled={searching || !search.trim()} title="搜索地区" aria-label="搜索地区"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-40">
              {searching ? <RefreshCw size={15} className="animate-spin" /> : <Search size={15} />}
            </button>
          </form>
          {searchError && <p role="alert" className="mt-2 text-rose-600 dark:text-rose-400">{searchError}</p>}
          <div className="mt-2 max-h-60 overflow-y-auto">
            {locations.map((place) => <button type="button" key={place.id} onClick={() => selectLocation(place)}
              className="block w-full rounded px-2 py-2 text-left hover:bg-sky-50 dark:hover:bg-slate-800">
              <span className="block font-semibold text-slate-900 dark:text-white">{place.name}</span>
              <span className="mt-0.5 block break-words text-[11px] text-slate-400">{regionLabel(place)}</span>
            </button>)}
          </div>
        </div>
      )}
    </div>
  );
}
