// Schedule the next request only after the entire previous refresh has settled.
export function startSerialPolling(poll, {
  delay = 1200,
  schedule = setTimeout,
  cancel = clearTimeout,
  immediate = false,
} = {}) {
  const controller = new AbortController();
  let timer;
  async function refresh() {
    if (controller.signal.aborted) return;
    let keepPolling = true;
    try {
      keepPolling = await poll(controller.signal) !== false;
    } catch {
      // A transient failure keeps the last visible state and retries after the delay.
    } finally {
      if (!controller.signal.aborted && keepPolling) timer = schedule(refresh, delay);
    }
  }
  if (immediate) void refresh();
  else timer = schedule(refresh, delay);
  return () => {
    controller.abort();
    cancel(timer);
  };
}
