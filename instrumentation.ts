export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const isDev = process.env.NODE_ENV === 'development';
    const enableSchedulers = process.env.ENABLE_SCHEDULERS === 'true';

    // 本地开发环境默认关闭后台高频定时扫描与爬虫，避免不必要的外网轮询与报错刷屏
    if (isDev && !enableSchedulers) {
      console.log('[instrumentation] 本地开发环境已关闭后台定时扫描与爬虫（如需开启可配置 ENABLE_SCHEDULERS=true）');
      return;
    }

    try {
      const { startTrendingScheduler } = await import('./lib/trending/scheduler');
      startTrendingScheduler();
    } catch (err: any) {
      console.warn('[instrumentation] Failed to start trending scheduler:', err?.message || err);
    }

    try {
      const { startCryptoSentinelScheduler } = await import('./lib/crypto/sentinel-service');
      startCryptoSentinelScheduler();
    } catch (err: any) {
      console.warn('[instrumentation] Failed to start crypto sentinel scheduler:', err?.message || err);
    }
  }
}
