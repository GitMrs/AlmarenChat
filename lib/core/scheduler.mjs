/**
 * Small process-local scheduler shared by background workers.
 * Business handlers remain responsible for persistence, claiming and retries.
 */
export function createScheduler({ name, pollMs, isStopping = () => false, logger = console }) {
  const tasks = new Map();
  let timer = null;
  let running = false;

  async function runOnce() {
    if (running || isStopping()) return;
    running = true;
    try {
      for (const [taskName, task] of tasks) {
        if (isStopping()) break;
        if (task.running) continue;
        task.running = true;
        try {
          await task.handler();
        } catch (error) {
          logger.warn(`[${name}] task ${taskName} failed:`, error?.message || error);
        } finally {
          task.running = false;
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    register(taskName, handler) {
      if (!taskName || typeof handler !== 'function') throw new TypeError('scheduler task requires a name and handler');
      tasks.set(taskName, { handler, running: false });
      return () => tasks.delete(taskName);
    },
    runOnce,
    start() {
      if (timer) return;
      void runOnce();
      timer = setInterval(() => void runOnce(), pollMs);
      timer.unref?.();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
