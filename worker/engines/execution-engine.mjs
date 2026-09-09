export const AGENT_EXECUTION_MODES = Object.freeze({
  EXECUTOR: 'executor',
  ADVISOR: 'advisor',
});

const EXECUTION_MODES = new Set(Object.values(AGENT_EXECUTION_MODES));
const EXECUTION_STATUSES = new Set(['completed', 'waiting', 'cancelled']);

export function assertExecutionRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('Agent execution request must be an object');
  }
  if (!EXECUTION_MODES.has(request.mode)) {
    throw new Error(`Unsupported agent execution mode: ${String(request.mode || '')}`);
  }
  return request;
}

export function assertExecutionEngine(engine) {
  if (!engine || typeof engine !== 'object') throw new TypeError('Agent execution engine must be an object');
  if (typeof engine.id !== 'string' || !engine.id.trim()) throw new TypeError('Agent execution engine id is required');
  if (typeof engine.execute !== 'function') throw new TypeError(`Agent execution engine ${engine.id} must implement execute()`);
  return engine;
}

export function normalizeExecutionResult(result, engine) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError(`Agent execution engine ${engine.id} returned an invalid result`);
  }
  if (!EXECUTION_STATUSES.has(result.status)) {
    throw new Error(`Agent execution engine ${engine.id} returned unsupported status: ${String(result.status || '')}`);
  }
  return {
    ...result,
    engineId: engine.id,
    engineVersion: engine.version || '1',
  };
}
