'use client';

import WeatherLocationPicker from '@/components/shared/WeatherLocationPicker';
import type { WeatherLocation } from '@/types/weather';
import { useWeatherLocation } from '@/lib/use-weather-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Cloud,
  CloudMoon,
  CloudRain,
  CloudSnow,
  Droplets,
  Moon,
  RefreshCw,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
  Thermometer,
  Wind,
  X,
} from 'lucide-react';
import AlmarenIslandScene, { Season, TimePhase, WeatherType } from './AlmarenIslandScene';
import styles from './TrendingWeather.module.css';

interface WeatherData {
  source: string;
  link?: string;
  location: WeatherLocation;
  observations: {
    temp: string;
    text: string;
    feelsLike?: string;
    obsTime: string;
    windDir?: string;
    windScale?: string;
    humidity?: string;
  };
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

function getSeason(date = new Date()): Season {
  const month = date.getMonth() + 1;
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

function getTimePhase(obsTime?: string, timezone?: string): TimePhase {
  let hour = new Date().getHours();
  if (obsTime) {
    try {
      const d = new Date(obsTime);
      if (!Number.isNaN(d.getTime())) {
        const hourStr = d.toLocaleTimeString('en-US', {
          hour12: false,
          hour: '2-digit',
          timeZone: timezone || 'Asia/Shanghai',
        });
        hour = parseInt(hourStr, 10);
      }
    } catch { /* Fallback to local browser hour */ }
  }
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 7 && hour < 17) return 'day';
  if (hour >= 17 && hour < 19.5) return 'dusk';
  return 'night';
}

function getWeatherType(conditionText: string): WeatherType {
  if (/雪/.test(conditionText)) return 'snow';
  if (/雨|雷/.test(conditionText)) return 'rain';
  if (/阴|雾|霾/.test(conditionText)) return 'overcast';
  if (/多云/.test(conditionText)) return 'cloudy';
  return 'clear';
}

function getConditionIcon(conditionText: string, phase: TimePhase) {
  if (/雪/.test(conditionText)) return CloudSnow;
  if (/雨|雷/.test(conditionText)) return CloudRain;
  if (/阴|雾|霾/.test(conditionText)) return Cloud;
  if (/多云/.test(conditionText)) return phase === 'night' ? CloudMoon : Cloud;
  if (phase === 'night') return Moon;
  if (phase === 'dawn') return Sunrise;
  if (phase === 'dusk') return Sunset;
  return Sun;
}

function timePhaseLabel(phase: TimePhase) {
  switch (phase) {
    case 'dawn': return '清晨·晨曦';
    case 'day': return '盛昼·白日';
    case 'dusk': return '黄昏·晚霞';
    case 'night': return '子夜·星海';
  }
}

function seasonLabel(s: Season) {
  switch (s) {
    case 'spring': return '春意';
    case 'summer': return '盛夏';
    case 'autumn': return '金秋';
    case 'winter': return '凛冬';
  }
}

function getWeatherWhisper(params: {
  temp: number;
  condition: string;
  windScale: number;
  timePhase: TimePhase;
}): string {
  const { temp, condition, windScale, timePhase } = params;

  // 极端/显著气象优先（8~9字精炼短句）
  if (/雷/.test(condition)) return '雷雨频现，注意防雷避雨';
  if (/暴雨|大雨/.test(condition)) return '雨势较大，留意出行安全';
  if (/雨/.test(condition)) return '今日有雨，出门记得带伞';
  if (/雪/.test(condition)) return '雪落天寒，地面湿滑慢行';
  if (/雾|霾/.test(condition)) return '能见度低，外出慢行慢走';
  if (windScale >= 5) return '风力强劲，外出注意防风';

  // 昼夜时相
  if (timePhase === 'night') {
    if (temp <= 10) return '夜深天凉，早点关灯安歇';
    return '海风轻拂，今晚睡个好梦';
  }
  if (timePhase === 'dawn') {
    return '晨光破晓，开启元气一天';
  }
  if (timePhase === 'dusk') {
    return '落日熔金，享受惬意归途';
  }

  // 常规气温与天气
  if (temp >= 32) return '天气炎热，注意防暑降温';
  if (temp <= 5) return '寒气逼人，记得裹紧外套';
  if (temp <= 16) return '温差微凉，适时增添衣物';
  if (/晴/.test(condition)) return '天朗气清，适宜出门散心';
  if (/多云|阴/.test(condition)) return '微云舒卷，今日体感舒适';

  return '晴雨有常，心向暖阳';
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
  const { location, loading: locationLoading, error: locationError, save: saveLocation } = useWeatherLocation();
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [previewPhase, setPreviewPhase] = useState<'auto' | TimePhase>('auto');

  const container = useRef<HTMLDivElement>(null);
  const detailsTrigger = useRef<HTMLButtonElement>(null);
  const weatherController = useRef<AbortController | null>(null);

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
    weatherController.current?.abort();
    setDetailsOpen(false);
    setWeather(null);
    setError('');
    setLoading(false);
    if (location) void loadWeather(location, true);
    return () => { weatherController.current?.abort(); };
  }, [location, loadWeather]);

  useEffect(() => {
    if (!detailsOpen) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setDetailsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetailsOpen(false);
        detailsTrigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [detailsOpen]);

  // 天气与时段参数解析
  const condition = weather?.observations.text || '';
  const autoPhase = getTimePhase(weather?.observations.obsTime, weather?.location.timezone);
  const activePhase = previewPhase === 'auto' ? autoPhase : previewPhase;
  const season = getSeason();
  const weatherType = getWeatherType(condition);
  const windScaleNum = parseInt(weather?.observations.windScale || '0', 10) || 0;
  const isWindy = /风|飑|飓/.test(condition) || windScaleNum >= 3;
  const isDarkSky = activePhase === 'night' || activePhase === 'dusk';
  const tempNum = parseFloat(weather?.observations.temp || '20') || 20;
  const whisperText = getWeatherWhisper({
    temp: tempNum,
    condition,
    windScale: windScaleNum,
    timePhase: activePhase,
  });

  // 触发栏与卡片内图标
  const TriggerIcon = getConditionIcon(condition, autoPhase);
  const ActiveIcon = getConditionIcon(condition, activePhase);

  const forecastLink = weatherPage(weather?.link);
  let observationTime = '';
  if (weather?.observations.obsTime && !Number.isNaN(Date.parse(weather.observations.obsTime))) {
    observationTime = new Date(weather.observations.obsTime).toLocaleTimeString('zh-CN', {
      hour: '2-digit', minute: '2-digit', timeZone: weather.location.timezone || 'Asia/Shanghai',
    });
  }

  return (
    <div ref={container} className="relative min-w-0 text-xs text-slate-600 dark:text-slate-300">
      {/* 顶部触发栏按钮 */}
      <div className="flex min-h-8 flex-wrap items-center justify-end gap-x-2 gap-y-1">
        <WeatherLocationPicker value={location} loading={locationLoading} error={locationError} onOpen={() => setDetailsOpen(false)} onChange={saveLocation} />
        {location && (
          <button
            ref={detailsTrigger}
            type="button"
            onClick={() => setDetailsOpen(!detailsOpen)}
            aria-label="查看天气详情"
            aria-expanded={detailsOpen}
            aria-controls="trending-weather-details"
            className="flex min-h-8 items-center gap-1.5 rounded-xl px-2 py-1 transition hover:bg-slate-100 dark:hover:bg-slate-800"
            title={weather ? `查看天气详情${observationTime ? ` · ${observationTime} 观测` : ''}` : '查看天气详情'}
          >
            {loading ? (
              <span role="status">加载中</span>
            ) : weather ? (
              <>
                <TriggerIcon size={16} className="text-sky-500" />
                <span>{condition}</span>
                <span className="font-semibold text-slate-900 dark:text-white">{weather.observations.temp}℃</span>
              </>
            ) : (
              <span>暂无数据</span>
            )}
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="max-w-sm text-right text-[11px] text-rose-600 dark:text-rose-400">
          {error}{weather ? '（显示上次数据）' : ''}
        </p>
      )}

      {/* 展开的天气详情卡片：阿尔玛伦微缩海岛 */}
      {detailsOpen && location && (
        <div
          id="trending-weather-details"
          role="dialog"
          aria-label="天气详情"
          className={`absolute right-0 top-full z-40 mt-2 w-[370px] max-w-[calc(100vw-2.5rem)] overflow-hidden rounded-3xl border p-5 shadow-2xl backdrop-blur-xl transition-all duration-700 ${
            isDarkSky
              ? 'border-white/20 text-white shadow-indigo-950/60'
              : 'border-white/60 text-slate-800 shadow-slate-900/15'
          } ${styles.panel}`}
        >
          {/* 阿尔玛伦微缩海岛动态全景层 */}
          <AlmarenIslandScene
            timePhase={activePhase}
            weatherType={weatherType}
            isWindy={isWindy}
            windScale={windScaleNum}
            windDir={weather?.observations.windDir}
            season={season}
          />

          {/* 前景内容层：通透穿透以响应海岛与灵树交互 */}
          <div className="relative z-10 pointer-events-none">
            {/* 顶栏：地点与拟时穿梭胶囊 */}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex flex-wrap items-center gap-1.5">
                <span className="truncate text-base font-bold" title={regionLabel(location)}>
                  {location.name}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold border ${
                    isDarkSky
                      ? 'border-white/20 bg-white/10 text-white/90'
                      : 'border-slate-900/15 bg-white/60 text-slate-700'
                  }`}
                >
                  {timePhaseLabel(activePhase)} · {seasonLabel(season)}
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0 pointer-events-auto">
                {/* 拟时穿梭机微胶囊 */}
                <div
                  className={`flex items-center rounded-full p-0.5 text-[10px] border shadow-sm ${
                    isDarkSky ? 'border-white/20 bg-black/40' : 'border-slate-900/15 bg-white/70'
                  }`}
                  role="group"
                  aria-label="拟时切换"
                >
                  {(['auto', 'dawn', 'day', 'dusk', 'night'] as const).map((phase) => {
                    const isSelected = previewPhase === phase;
                    const labels = { auto: '实时', dawn: '晨', day: '昼', dusk: '暮', night: '夜' };
                    return (
                      <button
                        key={phase}
                        type="button"
                        onClick={() => setPreviewPhase(phase)}
                        className={`rounded-full px-1.5 py-0.5 font-medium transition-all ${
                          isSelected
                            ? isDarkSky
                              ? 'bg-white font-bold text-slate-900 shadow-sm'
                              : 'bg-slate-900 font-bold text-white shadow-sm'
                            : isDarkSky
                            ? 'text-white/70 hover:text-white'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                        title={phase === 'auto' ? `根据当地观测时间实时呈现 (${timePhaseLabel(autoPhase)})` : `模拟体验【${labels[phase]}】时段海岛气象`}
                      >
                        {labels[phase]}
                      </button>
                    );
                  })}
                </div>

                {/* 关闭按钮 */}
                <button
                  type="button"
                  onClick={() => { setDetailsOpen(false); detailsTrigger.current?.focus(); }}
                  aria-label="关闭天气详情"
                  title="关闭天气详情"
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl transition ${
                    isDarkSky ? 'text-white/80 hover:bg-white/20 hover:text-white' : 'text-slate-700 hover:bg-black/10'
                  }`}
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            {/* 核心温湿度与气象呈现 */}
            {weather ? (
              <>
                <div className="mb-4 mt-6 flex items-end justify-between">
                  <div className="flex items-end gap-2.5">
                    <span className="text-5xl font-light leading-none tracking-tight drop-shadow-sm">
                      {weather.observations.temp}
                      <span className="align-top text-2xl font-normal">℃</span>
                    </span>
                    <div className="mb-0.5 flex flex-col">
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        <ActiveIcon size={18} />
                        {condition}
                      </span>
                      {isWindy && (
                        <span
                          className={`mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium ${
                            isDarkSky ? 'text-amber-300' : 'text-amber-700'
                          }`}
                        >
                          <Wind size={11} />
                          {windScaleNum ? `${windScaleNum}级` : ''}{weather.observations.windDir || '微风'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 气象指标：左侧通透排版，彻底移除遮挡海岛的色块底板 */}
                <div
                  className={`flex flex-col gap-1.5 pt-2 text-xs max-w-[215px] ${
                    isDarkSky
                      ? 'text-white/95 [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]'
                      : 'text-slate-800 [text-shadow:0_1px_2px_rgba(255,255,255,0.85)]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                      <Thermometer size={13} className={isDarkSky ? 'text-sky-300' : 'text-sky-600'} />
                      体感 {weather.observations.feelsLike ?? '--'}℃
                    </span>
                    <span className="flex items-center gap-1">
                      <Droplets size={13} className={isDarkSky ? 'text-cyan-300' : 'text-cyan-600'} />
                      湿度 {weather.observations.humidity != null ? `${weather.observations.humidity}%` : '--'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 truncate">
                    <Wind size={13} className={isDarkSky ? 'text-teal-300' : 'text-teal-600'} />
                    <span>
                      {weather.observations.windDir || '风向暂无'}
                      {weather.observations.windScale != null ? ` · ${weather.observations.windScale}级` : ''}
                      {isWindy ? ' (风力劲吹)' : ' (微风)'}
                    </span>
                  </div>
                </div>

                {/* 暖心一句话生活寄语 */}
                <div
                  className={`mt-3 flex items-center gap-1.5 text-[11px] leading-tight max-w-[235px] truncate ${
                    isDarkSky
                      ? 'text-white/85 [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]'
                      : 'text-slate-700 [text-shadow:0_1px_1px_rgba(255,255,255,0.85)]'
                  }`}
                  title={whisperText}
                >
                  <Sparkles size={11} className={isDarkSky ? 'text-amber-300 shrink-0' : 'text-amber-600 shrink-0'} />
                  <span className="truncate">{whisperText}</span>
                </div>
              </>
            ) : (
              <p role="status" className="py-8 text-sm">
                {loading ? '加载中' : '暂时没有天气数据'}
              </p>
            )}

            {/* 底栏：七天天气与刷新 */}
            <div
              className={`mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs pointer-events-auto ${
                isDarkSky ? 'border-white/15' : 'border-slate-900/10'
              }`}
            >
              {forecastLink ? (
                <a
                  href={forecastLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`flex items-center gap-1 transition hover:underline ${
                    isDarkSky ? 'text-white/80 hover:text-white' : 'text-slate-700 hover:text-slate-900'
                  }`}
                >
                  近七天天气预报
                  <ArrowUpRight size={13} />
                </a>
              ) : (
                <span />
              )}
              <button
                type="button"
                onClick={() => void loadWeather(location)}
                disabled={loading}
                aria-label="刷新天气"
                title={observationTime ? `${observationTime} 观测 · 点击刷新（5 分钟缓存）` : '刷新天气'}
                className={`flex h-7 min-w-7 items-center justify-center rounded-xl px-1 transition disabled:opacity-50 ${
                  isDarkSky ? 'text-white hover:bg-white/20' : 'text-slate-700 hover:bg-black/10'
                }`}
              >
                {loading ? <span role="status">加载中</span> : <RefreshCw size={14} />}
              </button>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}
