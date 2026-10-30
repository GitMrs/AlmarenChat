import test from 'node:test';
import assert from 'node:assert/strict';
import { startSerialPolling } from './serial-polling.mjs';

function scheduler() {
  const jobs = new Map();
  let id = 0;
  return {
    jobs,
    schedule(fn, delay) { jobs.set(++id, { fn, delay }); return id; },
    cancel(timer) { jobs.delete(timer); },
    run() {
      const [key, job] = jobs.entries().next().value;
      jobs.delete(key);
      assert.equal(job.delay, 1200);
      return job.fn();
    },
  };
}

test('slow refresh has no next timer until its promise resolves', async () => {
  const clock = scheduler();
  let resolve;
  let calls = 0;
  const stop = startSerialPolling(() => { calls++; return new Promise(done => { resolve = done; }); }, clock);
  const running = clock.run();
  assert.equal(calls, 1);
  assert.equal(clock.jobs.size, 0);
  resolve(true);
  await running;
  assert.equal(clock.jobs.size, 1);
  stop();
  assert.equal(clock.jobs.size, 0);
});

test('cleanup aborts an in-flight request and prevents rescheduling', async () => {
  const clock = scheduler();
  let signal;
  let resolve;
  const stop = startSerialPolling((value) => { signal = value; return new Promise(done => { resolve = done; }); }, clock);
  const running = clock.run();
  stop();
  assert.equal(signal.aborted, true);
  resolve(true);
  await running;
  assert.equal(clock.jobs.size, 0);
});

test('failures retry after completion while terminal runs stop polling', async () => {
  const clock = scheduler();
  let calls = 0;
  startSerialPolling(async () => { if (++calls === 1) throw new Error('暂时断网'); return false; }, clock);
  await clock.run();
  assert.equal(clock.jobs.size, 1);
  await clock.run();
  assert.equal(clock.jobs.size, 0);
});
