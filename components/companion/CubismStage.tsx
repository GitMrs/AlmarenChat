'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { CompanionCharacter } from '@/lib/companion/catalog';
import { ensureCubismRuntime } from '@/lib/companion/cubism-loader';
import type { FramingMode, StageHandle, StageProps, StageSnapshot } from './CompanionStage';

export const CubismStage = forwardRef<StageHandle, StageProps>(function CubismStage(props, ref) {
  const { character, zoom, focusOffsetY, framingMode } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const options = useRef(props);
  options.current = props;

  const appRef = useRef<any>(null);
  const modelRef = useRef<any>(null);
  const endedFiredRef = useRef<boolean>(false);
  const speakingTimeRef = useRef<number>(0);
  const manualSpeakUntilRef = useRef<number>(-Infinity);
  const snapshotTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [runtimeReady, setRuntimeReady] = useState(false);

  // 暴露舞台控制句柄
  useImperativeHandle(ref, () => ({
    restart() {
      endedFiredRef.current = false;
      const model = modelRef.current;
      if (!model) return;
      const activeMotion = options.current.character.motions.find(m => m.id === options.current.motionId);
      if (activeMotion?.cubismGroup !== undefined && activeMotion?.cubismIndex !== undefined) {
        try {
          model.motion(activeMotion.cubismGroup, activeMotion.cubismIndex, 3);
        } catch {}
      }
    },
    reset() {
      endedFiredRef.current = false;
      speakingTimeRef.current = 0;
      manualSpeakUntilRef.current = -Infinity;
      const model = modelRef.current;
      if (!model) return;
      try {
        model.motion('Idle', 0, 3);
        model.internalModel.motionManager.expressionManager?.resetExpression();
      } catch {}
    },
    seek(_time: number) {
      // Cubism 3/4 runtime 暂不支持单帧自由 seek，保持平滑播放
    },
    blink(_durationSec?: number) {
      const model = modelRef.current;
      if (!model) return;
      try {
        // 尝试触发内部眨眼
        const eyeBlink = model.internalModel.eyeBlink;
        if (eyeBlink && typeof eyeBlink.blink === 'function') {
          eyeBlink.blink();
        }
      } catch {}
    },
    speak(durationMs?: number) {
      manualSpeakUntilRef.current = Date.now() + (durationMs ?? 2000);
    },
    stopSpeaking() {
      manualSpeakUntilRef.current = -Infinity;
      const model = modelRef.current;
      if (model) {
        const paramId = character.id === 'mao' ? 'ParamA' : 'ParamMouthOpenY';
        try {
          model.internalModel.coreModel.setParameterValueById(paramId, 0);
        } catch {}
      }
    },
    setParameter(id: string, value: number) {
      const model = modelRef.current;
      if (!model) return;
      try {
        model.internalModel.coreModel.setParameterValueById(id, value);
      } catch {}
    },
    getParameter(id: string): number | undefined {
      const model = modelRef.current;
      if (!model) return undefined;
      try {
        return model.internalModel.coreModel.getParameterValueById(id);
      } catch {
        return undefined;
      }
    },
  }));

  // 1. 初始化 Pixi Application 与 Live2D Model
  useEffect(() => {
    let active = true;
    const canvas = canvasRef.current;
    if (!canvas) return;

    options.current.onMotionLoading(true);

    let app: any = null;
    let model: any = null;

    const init = async () => {
      try {
        await ensureCubismRuntime();
        if (!active) return;

        const PIXI = (window as any).PIXI;
        if (!PIXI || !PIXI.live2d?.Live2DModel) {
          throw new Error('Live2D 引擎未准备就绪');
        }

        // 初始化 PixiJS Application
        app = new PIXI.Application({
          view: canvas,
          autoStart: true,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
        });
        appRef.current = app;

        // 加载 Live2D 规范模型 (.model3.json)
        const modelUrl = `${character.modelRoot}/${character.modelFile ?? 'model.model3.json'}`;
        model = await PIXI.live2d.Live2DModel.from(modelUrl, {
          autoInteract: false,
        });

        if (!active) {
          model.destroy({ children: true });
          app.destroy(true, { children: true });
          return;
        }

        modelRef.current = model;
        app.stage.addChild(model);

        // 监听动作完成事件，联动 onEnded() 回调与循环逻辑
        model.internalModel.motionManager.on('motionFinish', () => {
          if (!active || endedFiredRef.current) return;
          endedFiredRef.current = true;

          const currentOptions = options.current;
          if (currentOptions.loop) {
            endedFiredRef.current = false;
            const curMotion = currentOptions.character.motions.find(m => m.id === currentOptions.motionId);
            if (curMotion?.cubismGroup !== undefined && curMotion?.cubismIndex !== undefined) {
              try {
                model.motion(curMotion.cubismGroup, curMotion.cubismIndex, 3);
              } catch {}
            }
          } else {
            currentOptions.onEnded();
          }
        });

        // 嘴型动作 / 说话联动 (beforeModelUpdate 钩子)
        model.internalModel.on('beforeModelUpdate', () => {
          if (!active) return;
          const isSpeaking = options.current.speaking || Date.now() < manualSpeakUntilRef.current;
          const paramId = character.id === 'mao' ? 'ParamA' : 'ParamMouthOpenY';
          try {
            if (isSpeaking) {
              speakingTimeRef.current += 0.016;
              const mouthOpen = 0.5 + 0.5 * Math.sin(speakingTimeRef.current * 14.0) * Math.sin(speakingTimeRef.current * 5.5 + 1.2);
              model.internalModel.coreModel.setParameterValueById(paramId, mouthOpen);
            } else {
              model.internalModel.coreModel.setParameterValueById(paramId, 0);
            }
          } catch {}
        });

        // 默认播放初始动作
        const initialMotion = character.motions.find(m => m.id === options.current.motionId) ?? character.motions[0];
        if (initialMotion?.cubismGroup !== undefined && initialMotion?.cubismIndex !== undefined) {
          endedFiredRef.current = false;
          try {
            model.motion(initialMotion.cubismGroup, initialMotion.cubismIndex, 3);
          } catch {}
        }

        setRuntimeReady(true);
        options.current.onReady();
        options.current.onMotionLoading(false);
      } catch (err) {
        if (!active) return;
        options.current.onMotionLoading(false);
        options.current.onError(err instanceof Error ? err.message : 'Live2D 模型初始化失败');
      }
    };

    init();

    return () => {
      active = false;
      if (model) {
        try {
          model.destroy({ children: true });
        } catch {}
      }
      if (app) {
        try {
          app.destroy(true, { children: true });
        } catch {}
      }
      modelRef.current = null;
      appRef.current = null;
      setRuntimeReady(false);
    };
  }, [character.id]);

  // 2. 视角、缩放与自适应排版
  useEffect(() => {
    const canvas = canvasRef.current;
    const app = appRef.current;
    const model = modelRef.current;
    if (!canvas || !app || !model || !runtimeReady) return;

    const updateLayout = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w <= 0 || h <= 0) return;

      // 移动端软键盘防挤压保护：输入框激活且仅高度缩小（宽度一致）时不重新计算立绘比例
      const isInputActive = typeof document !== 'undefined' && document.activeElement && (
        document.activeElement.tagName === 'INPUT' ||
        document.activeElement.tagName === 'TEXTAREA'
      );
      if (isInputActive && app.renderer.width > 0 && Math.abs(w - app.renderer.width) < 6 && h < app.renderer.height) {
        return;
      }

      app.renderer.resize(w, h);

      // 计算角色基准比例与居中
      const bh = model.internalModel.originalHeight || (model.height / model.scale.y) || 1200;
      const aspect = w / h;
      const isCloseup = framingMode === 'closeup' || (framingMode !== 'half' && framingMode !== 'full' && aspect < 0.65);
      const targetFraction = isCloseup ? 1.35 : framingMode === 'half' ? 0.95 : 0.82;
      const baseScale = (h * targetFraction) / bh;
      const finalScale = baseScale * (zoom || 1);
      model.scale.set(finalScale);

      model.anchor.set(0.5, 0.5);
      const offsetY = (focusOffsetY ?? 0) * (h * 0.35);
      const extraCloseupY = isCloseup ? h * 0.22 : 0;
      model.position.set(w / 2, h / 2 + offsetY + extraCloseupY);
    };

    updateLayout();

    const observer = new ResizeObserver(updateLayout);
    observer.observe(canvas);

    return () => observer.disconnect();
  }, [runtimeReady, zoom, focusOffsetY, framingMode]);

  // 3. 动作切换
  useEffect(() => {
    const model = modelRef.current;
    if (!model || !runtimeReady || !props.motionId) return;

    const motionDef = character.motions.find(m => m.id === props.motionId);
    if (motionDef?.cubismGroup !== undefined && motionDef?.cubismIndex !== undefined) {
      endedFiredRef.current = false;
      options.current.onMotionLoading(true);
      try {
        model.motion(motionDef.cubismGroup, motionDef.cubismIndex, 3);
      } catch (err) {
        options.current.onError(err instanceof Error ? err.message : '动作播放失败');
      } finally {
        options.current.onMotionLoading(false);
      }
    }
  }, [runtimeReady, props.motionId, character]);

  // 4. 表情切换
  useEffect(() => {
    const model = modelRef.current;
    if (!model || !runtimeReady) return;

    if (props.expressionId) {
      try {
        model.expression(props.expressionId);
      } catch {
        // 如果表情未匹配，保持当前表情
      }
    } else {
      try {
        model.internalModel.motionManager.expressionManager?.resetExpression();
      } catch {}
    }
  }, [runtimeReady, props.expressionId]);

  // 5. 播放速度与暂停控制
  useEffect(() => {
    const app = appRef.current;
    if (!app || !runtimeReady) return;

    app.ticker.speed = props.speed || 1;
    if (props.playing) {
      if (!app.ticker.started) app.ticker.start();
    } else {
      if (app.ticker.started) app.ticker.stop();
    }
  }, [runtimeReady, props.speed, props.playing]);

  // 6. 视线跟随与拖拽注视 (Pointer / Gaze LookAt)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !runtimeReady) return;

    let isPointerDown = false;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;

    const onPointerDown = (event: PointerEvent) => {
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

    let cachedRect: DOMRect | null = null;

    const onPointerMove = (event: PointerEvent) => {
      const model = modelRef.current;
      if (!model || !isPointerDown) return;

      if (!isDragging) {
        const dist = Math.hypot(event.clientX - dragStartX, event.clientY - dragStartY);
        if (dist >= 6) isDragging = true;
      }

      if (isDragging && options.current.lookAt !== false) {
        const rect = cachedRect || canvas.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const headCenterX = rect.left + rect.width / 2;
        const headCenterY = rect.top + rect.height * 0.35;
        const rx = (event.clientX - headCenterX) / (rect.width * 0.45);
        const ry = -(event.clientY - headCenterY) / (rect.height * 0.35);
        model.focus(Math.max(-1, Math.min(1, rx)), Math.max(-1, Math.min(1, ry)));
      }
    };

    const onPointerUp = () => {
      cachedRect = null;
      if (isPointerDown) {
        isPointerDown = false;
        isDragging = false;
        const model = modelRef.current;
        if (model) {
          model.focus(0, 0);
        }
      }
    };

    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    window.addEventListener('blur', onPointerUp);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('blur', onPointerUp);
    };
  }, [runtimeReady]);

  // 7. 定时汇报舞台状态快照 (FPS, Meshes, Time, Duration)
  useEffect(() => {
    if (!runtimeReady) return;

    snapshotTimerRef.current = setInterval(() => {
      const app = appRef.current;
      const model = modelRef.current;
      if (!app || !model) return;

      const meshes = model.internalModel?.coreModel?.getDrawableCount?.() ?? 0;
      const fps = Math.round(app.ticker?.FPS || 60);

      let time = 0;
      let duration = 3.0;
      try {
        const activeMotion = model.internalModel?.motionManager?.currentMotion;
        if (activeMotion) {
          time = Number(activeMotion._currentTime || 0);
          duration = Number(activeMotion.getDuration?.() || 3.0);
        }
      } catch {}

      options.current.onSnapshot({
        time,
        duration: duration || 3.0,
        fps,
        meshes,
      });
    }, 280);

    return () => {
      if (snapshotTimerRef.current) clearInterval(snapshotTimerRef.current);
    };
  }, [runtimeReady]);

  return <canvas ref={canvasRef} className="companion-canvas" />;
});
