import { assertExecutionEngine } from './execution-engine.mjs';

export function createExecutionEngineRegistry(engines, { defaultEngineId } = {}) {
  const engineMap = new Map();
  for (const candidate of engines || []) {
    const engine = assertExecutionEngine(candidate);
    if (engineMap.has(engine.id)) throw new Error(`Duplicate agent execution engine: ${engine.id}`);
    engineMap.set(engine.id, engine);
  }
  if (engineMap.size === 0) throw new Error('At least one agent execution engine is required');

  const fallbackId = defaultEngineId || engineMap.keys().next().value;
  if (!engineMap.has(fallbackId)) throw new Error(`Default agent execution engine is not registered: ${fallbackId}`);

  const resolve = (engineId) => {
    const requestedId = engineId || fallbackId;
    const engine = engineMap.get(requestedId);
    if (!engine) throw new Error(`Agent execution engine is not registered: ${requestedId}`);
    return engine;
  };

  return Object.freeze({
    defaultEngineId: fallbackId,
    resolve,
    execute(request, engineId, engineVersion = undefined) {
      const engine = resolve(engineId);
      if (engineVersion !== undefined && String(engineVersion) !== String(engine.version || '1')) {
        throw new Error(`Agent execution engine version is not registered: ${engine.id}@${engineVersion}`);
      }
      return engine.execute(request);
    },
    ids() {
      return [...engineMap.keys()];
    },
  });
}
