import path from 'node:path';

function boundedNumber(value, fallback, minimum, maximum = Number.POSITIVE_INFINITY) {
  const parsed = Number(value);
  const number = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

export function resolveWorkerDatabasePath(projectRoot, env = process.env) {
  const url = (env.DATABASE_URL || 'file:./dev.db').replace(/^['"]|['"]$/g, '');
  if (!url.startsWith('file:')) throw new Error('Node Agent Worker 第一阶段仅支持 SQLite DATABASE_URL');
  return path.resolve(projectRoot, url.slice('file:'.length));
}

export function workerConfig(env = process.env) {
  const modelTimeoutMs = boundedNumber(env.AGENT_MODEL_TIMEOUT_MS, 180_000, 30_000, 300_000);
  const heartbeatIntervalMs = boundedNumber(env.AGENT_WORKER_HEARTBEAT_MS, 5_000, 1_000);
  return {
    pollIntervalMs: boundedNumber(env.AGENT_WORKER_POLL_MS, 1_200, 250),
    modelTimeoutMs,
    heartbeatIntervalMs,
    leaseTimeoutMs: boundedNumber(env.AGENT_WORKER_LEASE_TIMEOUT_MS, 30_000, heartbeatIntervalMs * 3),
    taskTimeoutMs: boundedNumber(env.AGENT_TASK_TIMEOUT_MS, 10 * 60_000, modelTimeoutMs, 30 * 60_000),
    fakeMode: env.AGENT_WORKER_FAKE === '1',
  };
}
