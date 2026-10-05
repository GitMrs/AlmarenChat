export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { startTrendingScheduler } = await import('@/lib/trending/scheduler');
      startTrendingScheduler();
    } catch (err: any) {
      console.warn('[instrumentation] Failed to start trending scheduler:', err?.message || err);
    }
  }
}
