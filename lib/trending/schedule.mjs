import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SLOTS = ['08:00', '23:42'];
const MAX_LATENESS_MS = 60 * 1000;

/** Only select future slots: starting or restarting never catches up missed runs. */
export function getNextTrendingRun(now = new Date()) {
  const currentMs = now.getTime();
  if (!Number.isFinite(currentMs)) throw new TypeError('Invalid scheduler time');
  const shanghaiDay = Math.floor((currentMs + SHANGHAI_OFFSET_MS) / DAY_MS);
  for (const day of [shanghaiDay, shanghaiDay + 1]) {
    const date = new Date(day * DAY_MS).toISOString().slice(0, 10);
    for (const time of SLOTS) {
      const timestamp = Date.parse(`${date}T${time}:00+08:00`);
      if (timestamp > currentMs) {
        return { id: `${date}:${time}`, date, time, timestamp, scheduledAt: new Date(timestamp).toISOString() };
      }
    }
  }
}

export function createTrendingSchedule({
  run,
  directory = path.join(process.cwd(), 'data', 'trending', 'scheduler'),
  now = () => new Date(),
  logger = console,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let started = false;
  let timer;
  let generation = 0;

  async function execute(slot) {
    const elapsed = now().getTime() - slot.timestamp;
    // A clock change or suspended process must not turn this into a catch-up job.
    if (elapsed < 0 || elapsed >= MAX_LATENESS_MS) {
      logger.warn(`[trending-scheduler] Skipping missed slot ${slot.id}; waiting for the next scheduled time.`);
      return;
    }
    const file = path.join(directory, slot.date, `${slot.time.replace(':', '')}.json`);
    const record = {
      version: 1, id: slot.id, date: slot.date, time: slot.time,
      timeZone: 'Asia/Shanghai', scheduledAt: slot.scheduledAt,
      startedAt: now().toISOString(), status: 'RUNNING',
    };
    await mkdir(path.dirname(file), { recursive: true });
    try {
      // Exclusive creation also prevents duplicate runs across PM2 processes.
      await writeFile(file, JSON.stringify(record, null, 2), { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      logger.log(`[trending-scheduler] Slot ${slot.id} already claimed; skipping.`);
      return;
    }

    logger.log(`[trending-scheduler] Running scheduled sync: ${slot.id} (Asia/Shanghai).`);
    let outcome;
    try {
      const result = await run();
      outcome = { status: result?.success === false ? 'SKIPPED' : 'COMPLETED', result };
    } catch (error) {
      outcome = { status: 'FAILED', error: error?.message || String(error) };
      logger.warn(`[trending-scheduler] Scheduled sync ${slot.id} failed:`, outcome.error);
    }
    await writeFile(file, JSON.stringify({ ...record, ...outcome, completedAt: now().toISOString() }, null, 2));
  }

  function armNext(expectedGeneration) {
    if (!started || generation !== expectedGeneration) return;
    const slot = getNextTrendingRun(now());
    logger.log(`[trending-scheduler] Next sync: ${slot.date} ${slot.time} (Asia/Shanghai).`);
    timer = setTimer(async () => {
      if (!started || generation !== expectedGeneration) return;
      timer = undefined;
      try {
        await execute(slot);
      } catch (error) {
        logger.warn('[trending-scheduler] Schedule state error:', error?.message || error);
      } finally {
        armNext(expectedGeneration);
      }
    }, Math.max(1, slot.timestamp - now().getTime()));
    timer.unref?.();
  }

  return {
    start() {
      if (started) return;
      started = true;
      armNext(++generation);
    },
    stop() {
      started = false;
      generation++;
      if (timer !== undefined) clearTimer(timer);
      timer = undefined;
    },
  };
}
