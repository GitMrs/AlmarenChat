export function modelDebugLogsEnabled() {
  if (typeof window !== 'undefined') {
    try {
      return window.localStorage.getItem('almaren:debug:model-logs') === '1';
    } catch {
      return false;
    }
  }
  return typeof process !== 'undefined' && process.env.ALMAREN_MODEL_DEBUG_LOGS === '1';
}
