'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { KoroModel, type KoroRig } from '@/lib/companion/vendor/koro-core.js';
import type { CompanionCharacter, CompanionExpression } from '@/lib/companion/catalog';
import { CubismStage } from './CubismStage';
import {
  advancePlayback,
  applyMotion,
  blendSnapshot,
  advanceLookAt,
  applyLookAt,
  createLookAtState,
  type CompanionMotion,
  type LookAtState,
} from '@/lib/companion/motion';
import { PhysicsPlayer, type CompanionPhysics } from '@/lib/companion/physics';

export type FramingMode = 'auto' | 'closeup' | 'half' | 'full';

export interface StageSnapshot {
  time: number;
  duration: number;
  fps: number;
  meshes: number;
}

export interface StageHandle {
  restart(): void;
  reset(): void;
  seek(time: number): void;
  blink(durationSec?: number): void;
  speak(durationMs?: number): void;
  stopSpeaking(): void;
  setParameter(id: string, value: number): void;
  getParameter(id: string): number | undefined;
}

export interface StageProps {
  character: CompanionCharacter;
  motionId: string;
  expressionId: string;
  playing: boolean;
  loop: boolean;
  speed: number;
  zoom: number;
  focusOffsetY?: number;
  framingMode?: FramingMode;
  autoBlink: boolean;
  lookAt?: boolean;
  speaking?: boolean;
  customMotion?: CompanionMotion | null;
  seekTime?: number;
  paramOverrides?: Record<string, number>;
  onReady(): void;
  onError(message: string): void;
  onEnded(): void;
  onMotionLoading(loading: boolean): void;
  onSnapshot(snapshot: StageSnapshot): void;
}

interface BlinkState {
  openness: number;
  phase: 'idle' | 'closing' | 'holding' | 'opening';
  holdRemaining: number;
  queued: number;
}

function createBlinkState(): BlinkState {
  return {
    openness: 1,
    phase: 'idle',
    holdRemaining: 0,
    queued: 0,
  };
}

function triggerBlink(state: BlinkState) {
  if (state.phase === 'idle') {
    state.phase = 'closing';
    state.holdRemaining = 0.055;
  } else if (state.phase === 'opening') {
    state.phase = 'closing';
    state.holdRemaining = 0.045;
    state.queued = Math.min(state.queued + 1, 3);
  } else {
    state.queued = Math.min(state.queued + 1, 3);
    state.holdRemaining = Math.max(state.holdRemaining, 0.045);
  }
}

function updateBlink(state: BlinkState, delta: number): number {
  if (state.phase === 'idle') {
    return 1;
  }

  const isRapid = state.queued > 0;
  const closeRate = isRapid ? 32.0 : 25.0;
  const openRate = isRapid ? 16.0 : 12.0;
  const nextHold = isRapid ? 0.040 : 0.050;

  if (state.phase === 'closing') {
    state.openness = Math.max(0, state.openness - delta * closeRate);
    if (state.openness <= 0) {
      state.openness = 0;
      state.phase = 'holding';
    }
  } else if (state.phase === 'holding') {
    state.holdRemaining -= delta;
    state.openness = 0;
    if (state.holdRemaining <= 0) {
      state.phase = 'opening';
    }
  } else if (state.phase === 'opening') {
    state.openness = Math.min(1, state.openness + delta * openRate);
    if (state.openness >= 1) {
      state.openness = 1;
      if (state.queued > 0) {
        state.queued--;
        state.phase = 'closing';
        state.holdRemaining = nextHold;
      } else {
        state.phase = 'idle';
      }
    }
  }

  return state.openness;
}

function takeSnapshot(model: KoroModel): Float32Array {
  const snapshot = new Float32Array(model.params);
  for (const id of ['ParamEyeLOpen', 'ParamEyeROpen']) {
    const idx = model.paramIndex.get(id);
    if (idx !== undefined) snapshot[idx] = 1.0;
  }
  for (const id of ['ParamMouthOpenY']) {
    const idx = model.paramIndex.get(id);
    if (idx !== undefined) snapshot[idx] = 0.0;
  }
  return snapshot;
}

interface StageRuntime {
  model: KoroModel | null;
  motion: CompanionMotion | null;
  expression: CompanionExpression | null;
  time: number;
  elapsed: number;
  blink: BlinkState;
  lastAutoBlinkAt: number;
  resting: boolean;
  settlePhysics?: boolean;
  blendSnapshot: Float32Array | null;
  blendDuration: number;
  blendProgress: number;
  lookAt: LookAtState;
  isDragging?: boolean;
  speakingTime: number;
  mouthOpen: number;
  manualSpeakUntil: number;
  endedFired: boolean;
  uncompressedHeight?: number;
}

const resourceJsonCache = new Map<string, any>();

async function resource(character: CompanionCharacter, path: string, signal: AbortSignal) {
  const response = await fetch(`${character.modelRoot}/${path}`, { signal });
  if (!response.ok) throw new Error(`模型资源加载失败（${response.status}）`);
  return response;
}

async function cachedJsonResource<T = any>(character: CompanionCharacter, path: string, signal: AbortSignal): Promise<T> {
  const url = `${character.modelRoot}/${path}`;
  if (resourceJsonCache.has(url)) {
    return resourceJsonCache.get(url) as T;
  }
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`模型资源加载失败（${response.status}）`);
  const data = await response.json();
  resourceJsonCache.set(url, data);
  return data as T;
}

function projectionFor(model: KoroModel) {
  let minimumX = Infinity;
  let maximumX = -Infinity;
  let minimumY = Infinity;
  let maximumY = -Infinity;
  for (const mesh of model.man.art_meshes) {
    if (mesh._opacity <= 0.001) continue;
    for (let index = 0; index < mesh._world.length; index += 2) {
      minimumX = Math.min(minimumX, mesh._world[index]);
      maximumX = Math.max(maximumX, mesh._world[index]);
      minimumY = Math.min(minimumY, mesh._world[index + 1]);
      maximumY = Math.max(maximumY, mesh._world[index + 1]);
    }
  }
  if (![minimumX, maximumX, minimumY, maximumY].every(Number.isFinite) || minimumX >= maximumX || minimumY >= maximumY) {
    throw new Error('模型的显示范围无效');
  }
  return { minimumX, maximumX, minimumY, maximumY };
}

const KoroStage = forwardRef<StageHandle, StageProps>(function KoroStage(props, ref) {
  const { character } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const options = useRef(props);
  options.current = props;
  const runtime = useRef<StageRuntime>({
    model: null,
    motion: null,
    expression: null,
    time: 0,
    elapsed: 0,
    blink: createBlinkState(),
    lastAutoBlinkAt: 0,
    resting: false,
    blendSnapshot: null,
    blendDuration: 0.45,
    blendProgress: 1,
    lookAt: createLookAtState(),
    speakingTime: 0,
    mouthOpen: 0,
    manualSpeakUntil: -Infinity,
    endedFired: false,
  });
  const [ready, setReady] = useState(false);

  useImperativeHandle(ref, () => ({
    restart() {
      if (runtime.current.model) {
        runtime.current.blendSnapshot = takeSnapshot(runtime.current.model);
        runtime.current.blendDuration = 0.35;
        runtime.current.blendProgress = 0;
      }
      runtime.current.time = 0;
      runtime.current.resting = false;
      runtime.current.settlePhysics = true;
      runtime.current.endedFired = false;
    },
    reset() {
      if (runtime.current.model) {
        runtime.current.blendSnapshot = takeSnapshot(runtime.current.model);
        runtime.current.blendDuration = 0.45;
        runtime.current.blendProgress = 0;
      }
      runtime.current.time = 0;
      runtime.current.elapsed = 0;
      runtime.current.blink = createBlinkState();
      runtime.current.lastAutoBlinkAt = 0;
      runtime.current.speakingTime = 0;
      runtime.current.mouthOpen = 0;
      runtime.current.manualSpeakUntil = -Infinity;
      runtime.current.resting = true;
      runtime.current.settlePhysics = true;
      runtime.current.endedFired = false;
    },
    seek(time) {
      runtime.current.blendSnapshot = null;
      runtime.current.time = Math.max(0, Math.min(runtime.current.motion?.Meta.Duration ?? 0, time));
      runtime.current.resting = false;
      runtime.current.settlePhysics = true;
      runtime.current.endedFired = false;
    },
    blink(_durationSec?: number) {
      triggerBlink(runtime.current.blink);
    },
    speak(durationMs = 2200) {
      runtime.current.manualSpeakUntil = performance.now() + durationMs;
    },
    stopSpeaking() {
      runtime.current.manualSpeakUntil = -Infinity;
      runtime.current.speakingTime = 0;
    },
    setParameter(id: string, value: number) {
      runtime.current.model?.setParameter(id, value);
    },
    getParameter(id: string) {
      return runtime.current.model?.getParameter(id);
    },
  }), []);

  useEffect(() => {
    if (props.customMotion !== undefined) {
      if (props.customMotion) {
        runtime.current.motion = props.customMotion;
        runtime.current.time = props.seekTime ?? 0;
        runtime.current.resting = false;
        runtime.current.endedFired = false;
      } else {
        runtime.current.motion = null;
        runtime.current.endedFired = false;
      }
      options.current.onMotionLoading(false);
      return;
    }

    if (!props.motionId) {
      runtime.current.motion = null;
      runtime.current.endedFired = false;
      options.current.onMotionLoading(false);
      return;
    }

    const controller = new AbortController();
    options.current.onMotionLoading(true);
    const assetFolder = character.assetDir ?? (character.rig ? character.rig.split('/')[0] : character.name);
    const motionPath = character.motions.find(motion => motion.id === props.motionId)?.path
      ?? `${assetFolder}/motions/${props.motionId}.komo.json`;
    cachedJsonResource<CompanionMotion>(character, motionPath, controller.signal)
      .then((motion: CompanionMotion) => {
        if (controller.signal.aborted) return;
        if (motion.Version !== 3 || !(motion.Meta?.Duration > 0) || !Array.isArray(motion.Curves)) throw new Error('动作格式无效');
        if (runtime.current.model) {
          runtime.current.blendSnapshot = takeSnapshot(runtime.current.model);
          const fadeInTime = typeof motion.Meta?.FadeInTime === 'number' && motion.Meta.FadeInTime > 0
            ? Math.min(Math.max(motion.Meta.FadeInTime, 0.25), 0.6)
            : 0.45;
          runtime.current.blendDuration = fadeInTime;
          runtime.current.blendProgress = 0;
        }
        runtime.current.motion = motion;
        runtime.current.time = props.seekTime ?? 0;
        runtime.current.resting = false;
        runtime.current.endedFired = false;
        options.current.onMotionLoading(false);
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          options.current.onMotionLoading(false);
          options.current.onError(error instanceof Error ? error.message : '动作加载失败');
        }
      });
    return () => controller.abort();
  }, [character, props.motionId, props.customMotion]);

  useEffect(() => {
    const controller = new AbortController();
    const assetFolder = character.assetDir ?? (character.rig ? character.rig.split('/')[0] : character.name);
    if (props.expressionId) {
      cachedJsonResource<CompanionExpression>(character, `${assetFolder}/expressions/${props.expressionId}.koexp.json`, controller.signal)
        .then((expression: CompanionExpression) => {
          if (!controller.signal.aborted) {
            if (runtime.current.model) {
              runtime.current.blendSnapshot = takeSnapshot(runtime.current.model);
              runtime.current.blendDuration = 0.35;
              runtime.current.blendProgress = 0;
            }
            runtime.current.expression = expression;
          }
        })
        .catch(error => {
          if (!controller.signal.aborted) options.current.onError(error instanceof Error ? error.message : '表情加载失败');
        });
    } else {
      if (runtime.current.model) {
        runtime.current.blendSnapshot = takeSnapshot(runtime.current.model);
        runtime.current.blendDuration = 0.35;
        runtime.current.blendProgress = 0;
      }
      runtime.current.expression = null;
    }
    return () => controller.abort();
  }, [character, props.expressionId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) {
      options.current.onError('当前浏览器无法启用 WebGL2，请开启硬件加速后重试。');
      return;
    }

    const controller = new AbortController();
    const textures: WebGLTexture[] = [];
    let model: KoroModel | null = null;
    let animationFrame = 0;
    let lastFrame = 0;
    let snapshotAt = 0;
    let frameCount = 0;
    let active = true;
    let firstFrame = true;

    const fail = (error: unknown) => {
      if (active && !controller.signal.aborted) options.current.onError(error instanceof Error ? error.message : '模型播放失败');
    };
    const contextLost = (event: Event) => {
      event.preventDefault();
      cancelAnimationFrame(animationFrame);
      fail(new Error('图形上下文已中断，点击重新加载即可恢复。'));
    };
    canvas.addEventListener('webglcontextlost', contextLost);

    let isPointerDown = false;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let cachedRect: DOMRect | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (!canvas || !active) return;
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, form, input, .companion-floating-hud, .companion-dockbar, .companion-quick-reactions, .companion-controls, .companion-drawer-backdrop')) {
        return;
      }
      isPointerDown = true;
      isDragging = false;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      cachedRect = canvas.getBoundingClientRect();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!canvas || !active || !isPointerDown) return;
      if (!isDragging) {
        const dist = Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY);
        if (dist >= 6) {
          isDragging = true;
          runtime.current.isDragging = true;
        }
      }
      if (isDragging) {
        const rect = cachedRect || canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const aspect = rect.width / rect.height;
        const settings = options.current;
        const isCloseup = settings.framingMode === 'closeup' || (settings.framingMode !== 'half' && settings.framingMode !== 'full' && aspect < 0.65);
        const baseHeadRatio = isCloseup ? 0.28 : 0.38;
        const headCenterRatio = Math.max(0.1, Math.min(0.9, baseHeadRatio - (settings.focusOffsetY ?? 0) * 0.22));
        const headCenterX = rect.left + rect.width / 2;
        const headCenterY = rect.top + rect.height * headCenterRatio;
        const rx = (event.clientX - headCenterX) / (rect.width * 0.45);
        const ry = -(event.clientY - headCenterY) / (rect.height * 0.35);
        runtime.current.lookAt.targetX = Math.max(-1, Math.min(1, rx));
        runtime.current.lookAt.targetY = Math.max(-1, Math.min(1, ry));
      }
    };

    const onPointerUp = () => {
      cachedRect = null;
      if (isPointerDown) {
        isPointerDown = false;
        isDragging = false;
        runtime.current.isDragging = false;
        runtime.current.lookAt.targetX = 0;
        runtime.current.lookAt.targetY = 0;
      }
    };

    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    window.addEventListener('blur', onPointerUp);

    const resize = () => {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio));
      const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const load = async () => {
      if (!character.rig || !character.binary || !character.tuning || !character.textures) {
        throw new Error('Koro 格式模型缺少必要的资产配置');
      }
      const [rig, binary, tuning, pose, physicsData] = await Promise.all([
        resource(character, character.rig, controller.signal).then(response => response.json()) as Promise<KoroRig>,
        resource(character, character.binary, controller.signal).then(response => response.arrayBuffer()),
        resource(character, character.tuning, controller.signal).then(response => response.json()),
        character.pose ? resource(character, character.pose, controller.signal).then(response => response.json()) : null,
        character.physics ? resource(character, character.physics, controller.signal).then(response => response.json()) as Promise<CompanionPhysics> : null,
      ]);
      if (rig.format !== 'korig/1') throw new Error('模型格式不受支持');
      for (const texturePath of character.textures) {
        const response = await resource(character, texturePath, controller.signal);
        const bitmap = await createImageBitmap(await response.blob(), { premultiplyAlpha: 'premultiply' });
        try {
          if (!active) return;
          const texture = gl.createTexture();
          if (!texture) throw new Error('无法分配贴图');
          textures.push(texture);
          gl.bindTexture(gl.TEXTURE_2D, texture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        } finally {
          bitmap.close();
        }
      }
      if (!active) return;
      model = new KoroModel(gl, rig, binary, textures);
      runtime.current.model = model;
      model.applyTuning(tuning);
      if (pose) model.applyPose(pose);
      const physics = physicsData ? new PhysicsPlayer(physicsData, character.physicsWindSettings) : null;
      runtime.current.settlePhysics = true;
      const basePartOpacity = new Float32Array(model.partOpacity);
      model.update();
      const bounds = projectionFor(model);
      const projection = new Float32Array(16);
      projection[10] = projection[15] = 1;

      const frame = (now: number) => {
        if (!active || !model || gl.isContextLost()) return;
        if (document.hidden) {
          lastFrame = now;
          animationFrame = requestAnimationFrame(frame);
          return;
        }
        const delta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0;
        lastFrame = now;
        const settings = options.current;
        const state = runtime.current;
        try {
          model.man.parameters.forEach((parameter, index) => { model!.params[index] = parameter.default; });
          model.partOpacity.set(basePartOpacity);
          if (settings.seekTime !== undefined && !settings.playing) {
            state.time = settings.seekTime;
          }
          if (settings.playing && state.motion) {
            state.resting = false;
            state.elapsed += delta * settings.speed;
            const next = advancePlayback(state.time, delta * settings.speed, state.motion.Meta.Duration, settings.loop);
            state.time = next.time;
            if (next.ended) {
              if (!state.endedFired) {
                state.endedFired = true;
                settings.onEnded();
              }
            } else {
              state.endedFired = false;
            }
          }
          if (state.motion && !state.resting) applyMotion(model, state.motion, state.time);
          if (settings.paramOverrides) {
            for (const [id, value] of Object.entries(settings.paramOverrides)) {
              model.setParameter(id, value);
            }
          }
          for (const parameter of state.expression?.params ?? []) {
            const previous = model.getParameter(parameter.id);
            if (previous === undefined) continue;
            const value = parameter.blend === 'Overwrite' ? parameter.value
              : parameter.blend === 'Multiply' ? previous * parameter.value : previous + parameter.value;
            model.setParameter(parameter.id, value);
          }
          if (state.blendSnapshot && state.blendProgress < 1) {
            state.blendProgress = Math.min(1, state.blendProgress + (delta * (settings.speed || 1)) / (state.blendDuration || 0.45));
            blendSnapshot(model.params, state.blendSnapshot, state.blendProgress);
            if (state.blendProgress >= 1) {
              state.blendSnapshot = null;
            }
          }
          // 待机自然眨眼检测（每 4.5 秒自动自然眨眼一次）
          if (settings.autoBlink && state.blink.phase === 'idle') {
            if (state.elapsed - state.lastAutoBlinkAt > 4.5) {
              state.lastAutoBlinkAt = state.elapsed;
              triggerBlink(state.blink);
            }
          }

          // 眨眼状态机：支持单次触碰快速眨眼、高速连击无缝队列眨眼、眼弯月牙微表情联动
          const blinkOpenness = updateBlink(state.blink, delta);

          if (blinkOpenness < 0.999) {
            for (const id of ['ParamEyeLOpen', 'ParamEyeROpen']) {
              const currentVal = model.getParameter(id) ?? 1;
              model.setParameter(id, currentVal * blinkOpenness);
            }
          }

          // 说话口型动画联动 (Lip Sync / Mouth Flap)
          if (settings.speaking === false) {
            state.manualSpeakUntil = -Infinity;
          }
          const isSpeaking = Boolean(settings.speaking || (now < state.manualSpeakUntil));
          if (isSpeaking) {
            state.speakingTime += delta;
            const t = state.speakingTime;
            // 自然音节节律：主音节频率约 4.8Hz，次谐波辅音变化，辅以包络动态起伏
            const envelope = 0.58 + 0.38 * Math.sin(t * 7.2);
            const flap = Math.pow(Math.max(0, Math.sin(t * 22.0)), 1.4);
            const subFlap = 0.22 * Math.max(0, Math.sin(t * 36.0 + 1.2));
            const targetMouth = Math.min(0.92, flap * envelope + subFlap);
            // 平滑插值，避免突兀阶跃
            state.mouthOpen = state.mouthOpen * 0.35 + targetMouth * 0.65;
          } else {
            state.speakingTime = 0;
            // 停止说话时自然平滑闭合
            state.mouthOpen = Math.max(0, state.mouthOpen - delta * 9.0);
          }

          if (state.mouthOpen > 0.002) {
            model.setParameter('ParamMouthOpenY', state.mouthOpen);
            // 说话时轻微上扬嘴角，展现可爱元气的交流神态
            const currentForm = model.getParameter('ParamMouthForm') ?? 0;
            if (currentForm > -0.2) {
              model.setParameter('ParamMouthForm', Math.max(currentForm, 0.22 * Math.min(1, state.mouthOpen * 1.6)));
            }
          }
          const lookSpeed = state.isDragging ? 16.0 : 8.5;
          if (settings.lookAt !== false) {
            advanceLookAt(state.lookAt, delta, lookSpeed);
            applyLookAt(model, state.lookAt);
          } else {
            state.lookAt.targetX = 0;
            state.lookAt.targetY = 0;
            advanceLookAt(state.lookAt, delta, lookSpeed);
            if (Math.abs(state.lookAt.currentX) > 0.001 || Math.abs(state.lookAt.currentY) > 0.001) {
              applyLookAt(model, state.lookAt);
            }
          }
          if (physics) {
            if (state.settlePhysics) physics.settle(model);
            else {
              // 待机轻柔自然微风：双频正弦叠加，模拟室内温和气流，让发丝与丝带随时随地轻柔自然飘动
              const breezeX = Math.sin(state.elapsed * 1.5) * 0.12 + Math.sin(state.elapsed * 2.8) * 0.05;
              const breezeY = Math.cos(state.elapsed * 1.1) * 0.03;
              physics.setWind({ X: breezeX, Y: breezeY });
              physics.update(model, delta * (settings.speed || 1));
            }
            state.settlePhysics = false;
          }
          model.update();

          const isInputActive = typeof document !== 'undefined' && Boolean(
            document.activeElement &&
            (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')
          );

          // 记录未被移动端软键盘挤压时的真实完整画布高度
          if (!isInputActive || !state.uncompressedHeight) {
            if (!state.uncompressedHeight || canvas.height >= state.uncompressedHeight * 0.85) {
              state.uncompressedHeight = canvas.height;
            }
          }

          const effectiveNormalHeight = Math.max(canvas.height, state.uncompressedHeight || canvas.height);
          const compressionRatio = Math.max(0.4, Math.min(1, canvas.height / effectiveNormalHeight));
          const isCompressed = compressionRatio < 0.95;

          // 构图与特写判定使用未挤压的基础高宽比，防止软键盘弹起时角色从近景特写突变/退化为全身远景
          const layoutAspect = canvas.width / effectiveNormalHeight;
          const currentAspect = canvas.width / canvas.height;

          const modelHeight = bounds.maximumY - bounds.minimumY;
          const modelWidth = bounds.maximumX - bounds.minimumX;

          // 构图基准模式与参数调节
          const defaultCenterY = (bounds.maximumY + bounds.minimumY) / 2;
          const defaultHalfHeight = Math.max(modelHeight / 2, modelWidth / (2 * layoutAspect)) * 1.08;

          const closeupCenterY = bounds.minimumY + modelHeight * 0.20;
          const closeupHalfHeight = modelHeight * 0.25;

          const halfBodyCenterY = bounds.minimumY + modelHeight * 0.27;
          const halfBodyHalfHeight = modelHeight * 0.34;

          let baseCenterY: number;
          let baseHalfHeight: number;

          const mode = settings.framingMode || 'auto';
          if (mode === 'closeup') {
            baseCenterY = closeupCenterY;
            baseHalfHeight = closeupHalfHeight;
          } else if (mode === 'half') {
            baseCenterY = halfBodyCenterY;
            baseHalfHeight = halfBodyHalfHeight;
          } else if (mode === 'full') {
            baseCenterY = defaultCenterY;
            baseHalfHeight = defaultHalfHeight;
          } else {
            // 'auto': PC 端适中居中，移动端自动切为舒适半身中景（告别过度突脸与过大问题）
            const portraitFactor = Math.max(0, Math.min(1, (0.85 - layoutAspect) / 0.35));
            const portraitHalfHeight = character.id === 'yume' ? modelHeight * 0.35 : halfBodyHalfHeight;
            const portraitCenterY = character.id === 'yume' ? bounds.minimumY + modelHeight * 0.28 : halfBodyCenterY;
            baseHalfHeight = defaultHalfHeight * (1 - portraitFactor) + portraitHalfHeight * portraitFactor;
            baseCenterY = defaultCenterY * (1 - portraitFactor) + portraitCenterY * portraitFactor;
          }

          // 用户垂直镜头位置微调 (focusOffsetY: -1.0 ~ +1.0)
          const focusOffset = (settings.focusOffsetY ?? 0) * baseHalfHeight * 0.75;

          // 核心防缩放算法：利用 compressionRatio 补偿 halfHeight，保证像素级渲染尺度 100% 恒定，键盘挤压绝不缩水
          const halfHeight = (baseHalfHeight / settings.zoom) * compressionRatio;
          const halfWidth = halfHeight * currentAspect;
          const centerX = (bounds.maximumX + bounds.minimumX) / 2;

          let centerY = baseCenterY + focusOffset;
          if (isCompressed) {
            // 软键盘弹起时焦点平滑保持在面部与眼神区域，保证眼神对视自然留在剩余视口中
            const faceY = bounds.minimumY + modelHeight * 0.16;
            centerY = faceY + (baseCenterY - faceY) * compressionRatio + focusOffset;
          }

          projection[0] = 1 / halfWidth;
          projection[5] = -1 / halfHeight;
          projection[12] = -centerX / halfWidth;
          projection[13] = centerY / halfHeight;
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          gl.viewport(0, 0, canvas.width, canvas.height);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
          model.draw(projection);
          if (firstFrame) {
            if (gl.getError() !== gl.NO_ERROR) throw new Error('模型首次绘制失败');
            firstFrame = false;
            setReady(true);
            settings.onReady();
          }
          frameCount++;
          if (now - snapshotAt >= 250) {
            settings.onSnapshot({
              time: state.time,
              duration: state.motion?.Meta.Duration ?? 0,
              fps: snapshotAt ? Math.round(frameCount * 1000 / (now - snapshotAt)) : 0,
              meshes: model.man.art_meshes.length,
            });
            frameCount = 0;
            snapshotAt = now;
          }
          animationFrame = requestAnimationFrame(frame);
        } catch (error) {
          fail(error);
        }
      };
      animationFrame = requestAnimationFrame(frame);
    };
    load().catch(fail);

    return () => {
      active = false;
      controller.abort();
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', contextLost);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('blur', onPointerUp);
      runtime.current.model = null;
      if (model) model.dispose();
      else textures.forEach(texture => gl.deleteTexture(texture));
      if (!canvas.isConnected) gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, [character]);

  return <canvas ref={canvasRef} className="companion-canvas" aria-label={`${character.name} 动态角色`} data-model-ready={ready} />;
});

const CompanionStage = forwardRef<StageHandle, StageProps>(function CompanionStage(props, ref) {
  if (props.character.engine === 'cubism') {
    return <CubismStage ref={ref} {...props} />;
  }
  return <KoroStage ref={ref} {...props} />;
});

export default CompanionStage;
