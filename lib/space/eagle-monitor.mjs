import { normalizeFollowUpWatches, sampleFollowUpWatch } from './follow-up-watch.mjs';

export const EAGLE_RUNTIME_ID = 'FOLLOW_UP_WATCHES';
export const EAGLE_DELAY_MS = 90_000;
const messages = {
  MARKET_FETCH_FAILED: '行情获取失败，本次无法核验该条件',
  MARKET_DATA_UNAVAILABLE: '行情数据无效，本次不判断是否触发',
  STALE_DATA: '行情采样已过期，等待有效数据',
  CANDLE_DATA_UNAVAILABLE: '缺少有效的已收盘K线，暂无法核验',
  INVALID_CONDITIONS: '观察条件无效，需重新确认；定时跟进仍保留',
  MEMBER_UNAVAILABLE: '负责成员已不在空间中，条件监测未执行',
  TARGET_UNAVAILABLE: '关联成果已删除或不可用，条件监测未执行',
};

/** @param {{rules: any[], previousState?: any, previousHealth?: any, snapshots: any, event?: any, cooldown?: boolean, now: number, invalid?: boolean, failureCode?: string}} input */
export function buildWatchHealth({ rules, previousState, previousHealth, snapshots, event, cooldown, now, invalid = false, failureCode }) {
  const at = new Date(now).toISOString();
  const samples = rules.map(rule => {
    const snapshot = snapshots[rule.symbol];
    const sample = sampleFollowUpWatch(rule, snapshot, now);
    let errorCode = null;
    if (!sample) {
      errorCode = !snapshot ? 'MARKET_FETCH_FAILED' : rule.period !== 'PRICE' ? 'CANDLE_DATA_UNAVAILABLE'
        : now - Date.parse(snapshot.realtimeFetchedAt) > 90000 ? 'STALE_DATA' : 'MARKET_DATA_UNAVAILABLE';
    }
    const old = previousState?.[JSON.stringify(rule)];
    const crossed = sample && old && sample.at > old.at && (rule.direction === 'ABOVE'
      ? old.price <= rule.level && sample.price > rule.level : old.price >= rule.level && sample.price < rule.level);
    const state = !sample ? 'UNAVAILABLE' : !old ? 'BASELINE'
      : crossed ? 'CROSSED' : rule.period !== 'PRICE' && sample.at <= old.at ? 'WAITING_CLOSE' : 'WAITING';
    return { ...rule, state, price: sample?.price ?? null, sampledAt: sample ? new Date(sample.at).toISOString() : null,
      errorCode, message: errorCode ? messages[errorCode] : state === 'BASELINE' ? '已建立采样基准，首次采样不视为新穿越'
        : state === 'CROSSED' ? cooldown ? '已发现穿越，冷却期间不重复触发' : '已发现穿越，已请求提前复查'
          : state === 'WAITING_CLOSE' ? '等待下一根指定周期收盘' : '本次未发现新的穿越' };
  });
  const errorCode = failureCode || (invalid ? 'INVALID_CONDITIONS' : samples.find(row => row.errorCode)?.errorCode);
  const error = errorCode ? { code: errorCode, message: messages[errorCode], at } : null;
  const status = event && !cooldown ? 'TRIGGERED' : error ? 'DATA_ERROR' : cooldown ? 'COOLDOWN'
    : samples.every(row => row.state === 'BASELINE') ? 'BASELINE' : 'WATCHING';
  const message = status === 'TRIGGERED' ? '已唤醒原跟进任务，后续处理请查看跟进进度'
    : status === 'COOLDOWN' ? '发现条件变化，处于5分钟触发冷却期，稍后重新核验'
      : error ? error.message : status === 'BASELINE' ? '观察基准已建立' : '巡检完成，尚未触发提前复查';
  const events = Array.isArray(previousHealth?.events) ? [...previousHealth.events] : [];
  if (previousHealth?.status !== status || previousHealth?.error?.code !== error?.code) events.push({ at, status, message });
  return { status, message, lastCheckedAt: at,
    lastSuccessAt: error ? previousHealth?.lastSuccessAt ?? null : at,
    consecutiveFailures: error ? (previousHealth?.consecutiveFailures || 0) + 1 : 0,
    error, lastError: error || previousHealth?.lastError || null, samples, events: events.slice(-8) };
}

export function eagleRuntimeStatus(heartbeat, { enabled = true, pauseReason, conditions = 0, problemTasks = 0, unknownTasks = 0, now = Date.now() } = {}) {
  const base = { conditions, problemTasks, unknownTasks,
    lastStartedAt: heartbeat?.lastStartedAt ?? null, lastFinishedAt: heartbeat?.lastFinishedAt ?? null,
    lastSuccessAt: heartbeat?.lastSuccessAt ?? null, lastErrorAt: heartbeat?.lastErrorAt ?? null,
    consecutiveFailures: heartbeat?.consecutiveFailures || 0 };
  if (!enabled) return { ...base, state: 'PAUSED', label: '监测已暂停', message: pauseReason || '当前未启用跟进条件监测' };
  const latest = Math.max(Date.parse(base.lastStartedAt) || 0, Date.parse(base.lastFinishedAt) || 0);
  if (!latest || latest > now + 5000) return { ...base, state: 'UNKNOWN', label: '运行状态未知', message: '尚无有效巡检记录，不能确认鹰眼正在运行' };
  if (now - latest > EAGLE_DELAY_MS) return { ...base, state: 'DELAYED', label: '巡检延迟', message: '超过90秒未收到新巡检记录，不能确认持续监测中' };
  if (heartbeat.errorCode) return { ...base, state: 'ERROR', label: '巡检异常', message: '最近一次巡检处理失败，等待后续巡检恢复；定时跟进保留' };
  if (problemTasks) return { ...base, state: 'PARTIAL_ERROR', label: '部分条件异常', message: `${problemTasks}项任务暂无法完整核验，请展开对应任务查看` };
  if (unknownTasks) return { ...base, state: 'CHECKING', label: '条件待核验', message: `${unknownTasks}项任务尚无近期有效核验记录` };
  if (Date.parse(base.lastStartedAt) > (Date.parse(base.lastFinishedAt) || 0)) return { ...base, state: 'CHECKING', label: '正在巡检', message: '本轮巡检尚未完成' };
  return { ...base, state: conditions ? 'HEALTHY' : 'IDLE', label: conditions ? '监测正常' : '待命',
    message: conditions ? '已收到近期巡检结果；跟进是否完成请查看任务进度' : '巡检可用，当前没有等待监测的跟进条件' };
}

/** @param {any} db @param {any} space @param {{workId?: string, now?: Date, enabled?: boolean, pauseReason?: string}} options */
export async function readEagleMonitor(db, space, { workId, now = new Date(), enabled = true, pauseReason } = {}) {
  if (space.templateId !== 'crypto-contract-trading') return null;
  const active = await db.spaceFollowUp.findMany({ where: {
    spaceId: space.id, ...(workId ? { workId } : {}), domain: 'CRYPTO', status: 'PENDING', attempts: 0,
    networkAllowed: true, watchTriggeredAt: null, runAt: { gt: now }, nextAttemptAt: { gt: now },
    OR: [{ chainEndsAt: null }, { chainEndsAt: { gt: now } }],
  }, select: { watchConditions: true, watchHealth: true } });
  let conditions = 0, problemTasks = 0, unknownTasks = 0;
  for (const task of active) {
    try { conditions += normalizeFollowUpWatches(task.watchConditions).length; }
    catch { problemTasks++; continue; }
    if (!task.watchConditions?.length) continue;
    const checked = Date.parse(task.watchHealth?.lastCheckedAt);
    if (!checked || checked > now.getTime() + 5000 || now.getTime() - checked > EAGLE_DELAY_MS) unknownTasks++;
    else if (task.watchHealth?.error) problemTasks++;
  }
  const ownPaused = !space.followUpEnabled || space.templateSnapshot?.sentinelState?.serverSentinelEnabled === false;
  const heartbeat = await db.eagleRuntime.findUnique({ where: { id: EAGLE_RUNTIME_ID } });
  return eagleRuntimeStatus(heartbeat, { enabled: enabled && !ownPaused,
    pauseReason: ownPaused ? '本空间的自主跟进或鹰眼开关已关闭' : pauseReason,
    conditions, problemTasks, unknownTasks, now: now.getTime() });
}

export function watchHealthPresentation(task, now = Date.now()) {
  if (!task.watchConditions?.length && !task.watchHealth && !task.watchTriggeredAt) return null;
  if (task.watchTriggeredAt) return { state: 'TRIGGERED', label: '已触发提前复查', message: '鹰眼触发已记录；复查、审核和通知分别查看对应结果' };
  if (task.status !== 'PENDING' || task.attempts > 0 || Date.parse(task.runAt) <= now) return {
    state: 'ENDED', label: task.status === 'CANCELLED' ? '监测已取消' : '本次监测已交接或结束', message: '此处为监测记录，任务执行状态以跟进进度为准' };
  const health = task.watchHealth;
  if (!health?.lastCheckedAt) return { state: 'UNKNOWN', label: '尚无巡检记录', message: '已保存观察条件，暂不能确认是否开始监测' };
  if (now - Date.parse(health.lastCheckedAt) > EAGLE_DELAY_MS) return { state: 'DELAYED', label: '巡检记录延迟', message: '超过90秒没有新核验记录，不能确认当前监测有效' };
  const label = { DATA_ERROR: '条件核验异常', COOLDOWN: '触发冷却中', BASELINE: '观察基准已建立', WATCHING: '正在观察' }[health.status] || '状态待核验';
  return { state: health.status, label, message: health.message };
}
