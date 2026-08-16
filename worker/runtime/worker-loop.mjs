export async function runWorkerIteration({
  recover,
  claimCompletion,
  deliverCompletion,
  failCompletion,
  claimRun,
  processRun,
  heartbeatRun,
  releaseRun,
  claimDiscussion,
  processDiscussion,
  heartbeatIntervalMs,
  delay,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  recover();

  const completion = claimCompletion();
  if (completion) {
    try {
      deliverCompletion(completion);
    } catch (error) {
      failCompletion(completion, error);
    }
    return 'completion';
  }

  const run = claimRun();
  if (run) {
    const heartbeatTimer = setIntervalFn(() => heartbeatRun(run.id), heartbeatIntervalMs);
    heartbeatTimer?.unref?.();
    try {
      await processRun(run);
    } finally {
      clearIntervalFn(heartbeatTimer);
      releaseRun(run.id);
    }
    return 'run';
  }

  const discussion = claimDiscussion();
  if (discussion) {
    await processDiscussion(discussion);
    return 'discussion';
  }

  await delay();
  return 'idle';
}

export async function runWorkerLoop(options) {
  while (!options.isStopping()) await runWorkerIteration(options);
}
