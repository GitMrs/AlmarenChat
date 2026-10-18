'use client';

let cubismLoaderPromise: Promise<void> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      resolve();
      return;
    }

    const existing = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * 动态按需加载 PixiJS 与 Live2D Cubism 4 Core 运行环境
 * 只有在用户切换到 Cubism 角色（拉菲、真央等）时才触发加载，不阻碍初始页面与 Koro 模型加载。
 */
export function ensureCubismRuntime(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();

  const win = window as any;
  if (win.PIXI?.live2d?.Live2DModel && win.Live2DCubismCore) {
    return Promise.resolve();
  }

  if (!cubismLoaderPromise) {
    cubismLoaderPromise = (async () => {
      // 必须按照严格顺序执行：Pixi -> Live2D v2 -> Live2D Cubism Core v4 -> Pixi Live2D Display
      await loadScript('/companion/lib/pixi.min.js');
      await loadScript('/companion/lib/live2d.min.js');
      await loadScript('/companion/lib/live2dcubismcore.min.js');
      await loadScript('/companion/lib/pixi-live2d-display.min.js');

      // 再次确认是否加载成功
      if (!win.PIXI?.live2d?.Live2DModel) {
        throw new Error('Live2D 运行时初始化失败，请检查网络或刷新重试。');
      }
    })().catch(err => {
      cubismLoaderPromise = null;
      throw err;
    });
  }

  return cubismLoaderPromise;
}
