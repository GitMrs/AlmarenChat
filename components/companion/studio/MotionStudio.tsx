'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import Link from 'next/link';
import {
  Play,
  Pause,
  RotateCcw,
  Download,
  Upload,
  Plus,
  Trash2,
  SkipBack,
  SkipForward,
  Sparkles,
  ArrowLeft,
  Sliders,
  Check,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Film,
  Camera,
} from 'lucide-react';
import CompanionStage, { type StageHandle, type FramingMode } from '../CompanionStage';
import { companionCharacters, type CompanionCharacter } from '@/lib/companion/catalog';
import {
  COMMON_STUDIO_GROUPS,
  extractKeyframesFromMotion,
  exportKeyframesToMotion,
  interpolateParamsAtTime,
  type StudioKeyframe,
} from '@/lib/companion/studio-utils';
import type { CompanionMotion } from '@/lib/companion/motion';

interface MotionStudioProps {
  initialCharacter?: string;
  initialMotion?: string;
}

export default function MotionStudio({
  initialCharacter = 'nari',
  initialMotion = '',
}: MotionStudioProps) {
  const [characterId, setCharacterId] = useState<'nari' | 'yume'>(
    initialCharacter === 'yume' ? 'yume' : 'nari'
  );

  const character = useMemo<CompanionCharacter>(() => {
    return companionCharacters.find(c => c.id === characterId) ?? companionCharacters[0];
  }, [characterId]);

  // 参数分组定义
  const groups = useMemo(() => {
    return COMMON_STUDIO_GROUPS[characterId] ?? COMMON_STUDIO_GROUPS.nari;
  }, [characterId]);

  // 全量默认参数表
  const defaultParams = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const g of groups) {
      for (const p of g.params) {
        map[p.id] = p.default;
      }
    }
    return map;
  }, [groups]);

  // 动作与时间轴状态
  const [motionName, setMotionName] = useState<string>('自定义姿态动作');
  const [duration, setDuration] = useState<number>(3.0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLooping, setIsLooping] = useState<boolean>(true);
  const [keyframes, setKeyframes] = useState<StudioKeyframe[]>([
    { id: 'kf-start', time: 0, values: {} },
    { id: 'kf-end', time: 3.0, values: {} },
  ]);
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>('kf-start');
  const [activeGroup, setActiveGroup] = useState<string>('head');
  const [liveParams, setLiveParams] = useState<Record<string, number>>({});
  const [copyFeedback, setCopyFeedback] = useState<boolean>(false);

  // 视角与舞台状态
  const [framingMode, setFramingMode] = useState<FramingMode>('auto');
  const [zoom, setZoom] = useState<number>(1.0);
  const [focusOffsetY, setFocusOffsetY] = useState<number>(0);
  const [sceneBg, setSceneBg] = useState<'none' | 'cherry_room' | 'ocean_room'>('cherry_room');

  const stageRef = useRef<StageHandle>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isScrubbingRef = useRef<boolean>(false);

  // 载入动作数据（预设或外部）
  const loadPresetMotion = useCallback(async (motionId: string) => {
    if (!motionId) return;
    const motionDef = character.motions.find(m => m.id === motionId);
    if (!motionDef) return;

    try {
      const path = motionDef.path ?? `${character.name}/motions/${motionDef.id}.komo.json`;
      const url = `${character.modelRoot}/${path}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: CompanionMotion = await res.json();

      const { duration: d, keyframes: kfs } = extractKeyframesFromMotion(json);
      setMotionName(motionDef.label);
      setDuration(d);
      setKeyframes(kfs);
      setCurrentTime(0);
      setIsPlaying(false);
      setSelectedKeyframeId(kfs[0]?.id || null);
    } catch (e) {
      console.error('载入预设动作失败:', e);
    }
  }, [character]);

  // 初始化加载动作
  useEffect(() => {
    if (initialMotion) {
      loadPresetMotion(initialMotion);
    }
  }, [initialMotion, loadPresetMotion]);

  // 根据当前时间计算并插值全部参数
  useEffect(() => {
    const interpolated = interpolateParamsAtTime(keyframes, currentTime, defaultParams);
    setLiveParams(interpolated);

    // 联动高亮关键帧指示器
    const matched = keyframes.find(k => Math.abs(k.time - currentTime) < 0.04);
    setSelectedKeyframeId(matched ? matched.id : null);
  }, [keyframes, currentTime, defaultParams]);

  // 播放帧循环 (Animation Playback Loop)
  useEffect(() => {
    if (!isPlaying) return;
    let lastStamp = performance.now();
    let frameId: number;

    const tick = (now: number) => {
      const delta = (now - lastStamp) / 1000;
      lastStamp = now;

      setCurrentTime(prev => {
        const next = prev + delta;
        if (next >= duration) {
          if (isLooping) return 0;
          setIsPlaying(false);
          return duration;
        }
        return next;
      });

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, duration, isLooping]);

  // 时间轴点击与拖拽跳转 (Timeline Scrubbing)
  const handleTimelineScrub = useCallback((clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const newTime = Number(((x / rect.width) * duration).toFixed(3));
    setCurrentTime(newTime);
  }, [duration]);

  const handleTrackPointerDown = (e: React.PointerEvent) => {
    isScrubbingRef.current = true;
    setIsPlaying(false);
    handleTimelineScrub(e.clientX);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleTrackPointerMove = (e: React.PointerEvent) => {
    if (isScrubbingRef.current) {
      handleTimelineScrub(e.clientX);
    }
  };

  const handleTrackPointerUp = (e: React.PointerEvent) => {
    if (isScrubbingRef.current) {
      isScrubbingRef.current = false;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
    }
  };

  // 修改单个参数值并记录到关键帧
  const handleParamChange = (paramId: string, val: number) => {
    const rounded = Number(val.toFixed(3));
    // 1. 实时修改展示参数
    setLiveParams(prev => ({ ...prev, [paramId]: rounded }));

    // 2. 如果当前时间刚好处于某个关键帧上（<0.04s），直接同步到该关键帧
    const matched = keyframes.find(k => Math.abs(k.time - currentTime) < 0.04);
    if (matched) {
      setKeyframes(prev => prev.map(k => {
        if (k.id === matched.id) {
          return { ...k, values: { ...k.values, [paramId]: rounded } };
        }
        return k;
      }));
    }
  };

  // 在当前时间打上一个完整的关键帧 (Insert Keyframe)
  const handleInsertKeyframe = () => {
    const time = Number(currentTime.toFixed(3));
    const newId = `kf-${Date.now()}`;
    const newKeyframe: StudioKeyframe = {
      id: newId,
      time,
      values: { ...liveParams },
    };

    setKeyframes(prev => {
      // 移除非常靠近的旧帧并插入新帧
      const withoutNear = prev.filter(k => Math.abs(k.time - time) >= 0.04);
      return [...withoutNear, newKeyframe].sort((a, b) => a.time - b.time);
    });
    setSelectedKeyframeId(newId);
  };

  // 删除当前选中的关键帧
  const handleDeleteKeyframe = () => {
    if (keyframes.length <= 1) return; // 至少保留 1 个基础帧
    setKeyframes(prev => prev.filter(k => Math.abs(k.time - currentTime) >= 0.04));
    setSelectedKeyframeId(null);
  };

  // 跳至上一帧 / 下一帧
  const handleJumpKeyframe = (direction: 'prev' | 'next') => {
    const sorted = [...keyframes].sort((a, b) => a.time - b.time);
    if (direction === 'prev') {
      const candidates = sorted.filter(k => k.time < currentTime - 0.04);
      if (candidates.length > 0) {
        setCurrentTime(candidates[candidates.length - 1].time);
      } else {
        setCurrentTime(0);
      }
    } else {
      const candidates = sorted.filter(k => k.time > currentTime + 0.04);
      if (candidates.length > 0) {
        setCurrentTime(candidates[0].time);
      } else {
        setCurrentTime(duration);
      }
    }
  };

  // 新建空白动作 (New Blank Motion)
  const handleNewMotion = () => {
    setMotionName('自制全新动作');
    setDuration(3.0);
    setCurrentTime(0);
    setIsPlaying(false);
    setKeyframes([
      { id: 'kf-start', time: 0, values: { ...defaultParams } },
      { id: 'kf-mid', time: 1.5, values: { ...defaultParams } },
      { id: 'kf-end', time: 3.0, values: { ...defaultParams } },
    ]);
  };

  // 导出标准 Live2D .komo.json 文件
  const handleExportMotion = () => {
    const motion = exportKeyframesToMotion(duration, keyframes, 30);
    const jsonString = JSON.stringify(motion, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${character.name}_${motionName || 'custom_motion'}.komo.json`;
    a.click();
    URL.revokeObjectURL(url);

    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2400);
  };

  // 本地文件导入 (Import Local File)
  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const json: CompanionMotion = JSON.parse(text);
        if (!json.Curves || !json.Meta) {
          alert('文件格式不正确，缺少 Curves 或 Meta 属性');
          return;
        }
        const { duration: d, keyframes: kfs } = extractKeyframesFromMotion(json);
        const nameWithoutExt = file.name.replace(/\.(komo|motion3)?\.json$/i, '');
        setMotionName(nameWithoutExt);
        setDuration(d);
        setKeyframes(kfs);
        setCurrentTime(0);
        setIsPlaying(false);
      } catch (err) {
        alert(`导入动作文件解析失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // 生成当前编辑中动作的实效预览
  const customMotionObject = useMemo<CompanionMotion>(() => {
    return exportKeyframesToMotion(duration, keyframes, 30);
  }, [duration, keyframes]);

  return (
    <div className="studio-page" data-character={characterId}>
      {/* 顶部工具栏 (Navbar) */}
      <header className="studio-navbar">
        <div className="studio-nav-left">
          <Link href="/companion" className="studio-back-btn" title="返回伴侣聊天空间">
            <ArrowLeft size={14} />
            <span>伴侣空间</span>
          </Link>
          <div className="studio-brand">
            <span>Almaren 动作调校工坊</span>
            <span className="studio-brand-badge">Motion Studio</span>
          </div>
        </div>

        <div className="studio-nav-mid">
          {/* 角色快速切换 */}
          <div className="studio-char-toggle" role="group" aria-label="角色切换">
            <button
              type="button"
              className={`studio-char-btn ${characterId === 'nari' ? 'is-active' : ''}`}
              onClick={() => setCharacterId('nari')}
            >
              🌸 Nari
            </button>
            <button
              type="button"
              className={`studio-char-btn ${characterId === 'yume' ? 'is-active' : ''}`}
              onClick={() => setCharacterId('yume')}
            >
              🌊 Yume
            </button>
          </div>

          {/* 载入预设动作下拉选单 */}
          <select
            className="studio-motion-select"
            value={character.motions.find(m => m.label === motionName)?.id || ''}
            onChange={(e) => loadPresetMotion(e.target.value)}
            title="选择一个官方预设动作作为底模进行二次微调"
          >
            <option value="" disabled>载入官方预设动作 ({character.motions.length})</option>
            {character.motions.map(m => (
              <option key={m.id} value={m.id}>{m.label} ({m.group})</option>
            ))}
          </select>

          <button
            type="button"
            className="studio-action-btn"
            onClick={handleNewMotion}
            title="清空并开始编排一段全新动作"
          >
            <Plus size={13} />
            <span>新建空白</span>
          </button>
        </div>

        <div className="studio-nav-right">
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            accept=".json,.komo.json"
            onChange={handleFileImport}
          />
          <button
            type="button"
            className="studio-action-btn"
            onClick={() => fileInputRef.current?.click()}
            title="从本地电脑导入任意 .komo.json 或 Live2D motion3.json 文件"
          >
            <Upload size={13} />
            <span>导入文件</span>
          </button>

          <button
            type="button"
            className="studio-action-btn is-primary"
            onClick={handleExportMotion}
            title="将当前调校的关键帧导出为标准 Live2D 动作文件"
          >
            {copyFeedback ? <Check size={13} /> : <Download size={13} />}
            <span>{copyFeedback ? '已导出下载！' : '导出 .komo.json'}</span>
          </button>
        </div>
      </header>

      {/* 中央主体工作区 */}
      <div className="studio-body">
        {/* 左侧视口舞台 */}
        <section className="studio-viewport" aria-label="模型实时预览画布">
          {/* 实景背景 */}
          {sceneBg === 'cherry_room' && (
            <div className="companion-scene-backdrop companion-scene-backdrop--cherry" aria-hidden="true" />
          )}
          {sceneBg === 'ocean_room' && (
            <div className="companion-scene-backdrop companion-scene-backdrop--ocean" aria-hidden="true" />
          )}

          {/* 舞台悬浮微调节器 */}
          <div className="studio-viewport-hud">
            <div className="studio-viewport-pill">
              <span>场景：</span>
              <button
                type="button"
                className={`studio-viewport-btn ${sceneBg === 'cherry_room' ? 'is-active' : ''}`}
                onClick={() => setSceneBg('cherry_room')}
              >
                🌸 花房
              </button>
              <button
                type="button"
                className={`studio-viewport-btn ${sceneBg === 'ocean_room' ? 'is-active' : ''}`}
                onClick={() => setSceneBg('ocean_room')}
              >
                🌊 海景
              </button>
              <button
                type="button"
                className={`studio-viewport-btn ${sceneBg === 'none' ? 'is-active' : ''}`}
                onClick={() => setSceneBg('none')}
              >
                极简
              </button>
            </div>

            <div className="studio-viewport-pill">
              <span>镜头：</span>
              <button
                type="button"
                className={`studio-viewport-btn ${framingMode === 'closeup' ? 'is-active' : ''}`}
                onClick={() => setFramingMode('closeup')}
              >
                特写
              </button>
              <button
                type="button"
                className={`studio-viewport-btn ${framingMode === 'half' ? 'is-active' : ''}`}
                onClick={() => setFramingMode('half')}
              >
                半身
              </button>
              <button
                type="button"
                className={`studio-viewport-btn ${framingMode === 'full' ? 'is-active' : ''}`}
                onClick={() => setFramingMode('full')}
              >
                全身
              </button>
              <button
                type="button"
                className="studio-viewport-btn"
                onClick={() => {
                  setFramingMode('auto');
                  setZoom(1.0);
                  setFocusOffsetY(0);
                  stageRef.current?.reset();
                }}
                title="重置镜头视角"
              >
                <RotateCcw size={11} />
              </button>
            </div>
          </div>

          {/* WebGL Stage 渲染容器 */}
          <div className="studio-stage-wrapper">
            <CompanionStage
              key={`${characterId}`}
              ref={stageRef}
              character={character}
              motionId=""
              customMotion={customMotionObject}
              seekTime={currentTime}
              paramOverrides={isPlaying ? undefined : liveParams}
              expressionId=""
              playing={isPlaying}
              loop={isLooping}
              speed={1.0}
              zoom={zoom}
              focusOffsetY={focusOffsetY}
              framingMode={framingMode}
              autoBlink={false}
              lookAt={false}
              onReady={() => {}}
              onError={(msg) => console.warn(msg)}
              onEnded={() => setIsPlaying(false)}
              onMotionLoading={() => {}}
              onSnapshot={() => {}}
            />
          </div>
        </section>

        {/* 右侧骨骼姿态检查器 (Inspector) */}
        <aside className="studio-inspector" aria-label="骨骼参数微调面板">
          <div className="studio-inspector-header">
            <h3>
              <Sliders size={14} />
              <span>姿态检查器 (Inspector)</span>
            </h3>
            <button
              type="button"
              className="studio-action-btn"
              onClick={handleInsertKeyframe}
              title="将当前滑块摆好的所有姿态记录到当前播放头所在的时间点"
            >
              <Plus size={12} />
              <span>在此时间打关键帧</span>
            </button>
          </div>

          {/* 属性分类选项卡 */}
          <div className="studio-group-tabs">
            {groups.map(g => (
              <button
                key={g.id}
                type="button"
                className={`studio-group-tab ${activeGroup === g.id ? 'is-active' : ''}`}
                onClick={() => setActiveGroup(g.id)}
              >
                <span>{g.emoji}</span>
                <span>{g.label}</span>
              </button>
            ))}
          </div>

          {/* 对应分类的参数滑块列表 */}
          <div className="studio-param-list">
            {groups.find(g => g.id === activeGroup)?.params.map(p => {
              const currentVal = liveParams[p.id] ?? p.default;
              return (
                <div key={p.id} className="studio-param-item">
                  <div className="studio-param-header">
                    <span className="studio-param-label">{p.label}</span>
                    <span className="studio-param-val-badge">
                      {currentVal.toFixed(2)}{p.unit || ''}
                    </span>
                  </div>
                  <div className="studio-param-row">
                    <input
                      type="range"
                      className="studio-param-slider"
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      value={currentVal}
                      onChange={(e) => handleParamChange(p.id, Number(e.target.value))}
                    />
                    <button
                      type="button"
                      className="studio-param-reset-btn"
                      onClick={() => handleParamChange(p.id, p.default)}
                      title="重置为默认值"
                    >
                      <RotateCcw size={11} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>

      {/* 底部宽幅时间轴 (Timeline) */}
      <footer className="studio-timeline">
        {/* 控制条 */}
        <div className="studio-timeline-toolbar">
          <div className="studio-timeline-playback">
            <button
              type="button"
              className="studio-play-btn"
              onClick={() => setIsPlaying(p => !p)}
              title={isPlaying ? '暂停 (Space)' : '播放 (Space)'}
            >
              {isPlaying ? <Pause size={14} /> : <Play size={14} style={{ marginLeft: 2 }} />}
            </button>
            <button
              type="button"
              className="studio-time-btn"
              onClick={() => setCurrentTime(0)}
              title="回到起始帧"
            >
              <RotateCcw size={12} />
            </button>
            <button
              type="button"
              className="studio-time-btn"
              onClick={() => handleJumpKeyframe('prev')}
              title="跳至上一个关键帧"
            >
              <SkipBack size={12} />
            </button>
            <button
              type="button"
              className="studio-time-btn"
              onClick={() => handleJumpKeyframe('next')}
              title="跳至下一个关键帧"
            >
              <SkipForward size={12} />
            </button>
            <div className="studio-time-counter">
              {currentTime.toFixed(2)}s <span>/ {duration.toFixed(2)}s</span>
            </div>
          </div>

          <div className="studio-timeline-actions">
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--studio-muted)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isLooping}
                onChange={e => setIsLooping(e.target.checked)}
              />
              <span>循环播放</span>
            </label>

            <button
              type="button"
              className="studio-kf-btn is-add"
              onClick={handleInsertKeyframe}
              title="在当前时间点插入关键帧"
            >
              <Plus size={12} />
              <span>插入关键帧</span>
            </button>

            <button
              type="button"
              className="studio-kf-btn"
              onClick={handleDeleteKeyframe}
              title="删除当前时间点的关键帧"
              disabled={!selectedKeyframeId}
            >
              <Trash2 size={12} />
              <span>删除帧</span>
            </button>
          </div>
        </div>

        {/* 标尺与主时间轴轨道 */}
        <div
          className="studio-track-area"
          ref={trackRef}
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={handleTrackPointerUp}
          onPointerCancel={handleTrackPointerUp}
        >
          {/* 标尺刻度 */}
          <div className="studio-ruler">
            {Array.from({ length: Math.ceil(duration * 2) + 1 }).map((_, i) => {
              const tickTime = i * 0.5;
              if (tickTime > duration) return null;
              const leftPercent = (tickTime / duration) * 100;
              return (
                <div
                  key={tickTime}
                  className="studio-ruler-tick"
                  style={{ left: `${leftPercent}%` }}
                >
                  <div className="studio-ruler-tick-mark" />
                  <span className="studio-ruler-tick-label">{tickTime.toFixed(1)}s</span>
                </div>
              );
            })}
          </div>

          {/* 轨道主体与关键帧 */}
          <div className="studio-track-body">
            <div className="studio-track-bar">
              {/* 关键帧菱形标记 */}
              {keyframes.map(kf => {
                const leftPercent = Math.max(0, Math.min(100, (kf.time / duration) * 100));
                const isActive = Math.abs(kf.time - currentTime) < 0.04;
                return (
                  <div
                    key={kf.id}
                    className={`studio-kf-marker ${isActive ? 'is-active' : ''}`}
                    style={{ left: `${leftPercent}%` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setCurrentTime(kf.time);
                      setSelectedKeyframeId(kf.id);
                    }}
                    title={`关键帧：${kf.time.toFixed(2)}s`}
                  />
                );
              })}
            </div>

            {/* 播放指针 (Playhead) */}
            <div
              className="studio-playhead-needle"
              style={{ left: `${Math.max(0, Math.min(100, (currentTime / duration) * 100))}%` }}
            >
              <div className="studio-playhead-cap" />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
