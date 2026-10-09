export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // 默认保持本地直连优先；当且仅当直连异常时，由底层调度器在单次请求级别自动切换本地代理

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
