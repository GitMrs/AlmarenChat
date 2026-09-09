export async function runWorkerIteration({
  recover,
  triggerAutomation,
  claimCompletion,
  deliverCompletion,
  failCompletion,
  claimConnectorExecution,
  processConnectorExecution,
  claimRun,
  processRun,
  heartbeatRun,
  releaseRun,
  claimDiscussion,
  processDiscussion,
  claimRelay,
  processRelay,
  heartbeatIntervalMs,
  delay,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  recover();
  triggerAutomation?.();

  const completion = claimCompletion();
  if (completion) {
    try {
      deliverCompletion(completion);
    } catch (error) {
      failCompletion(completion, error);
    }
    return 'completion';
  }

  const connectorExecution = claimConnectorExecution?.();
  if (connectorExecution) {
    await processConnectorExecution(connectorExecution);
    return 'connector-action';
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

  const relay = claimRelay();
  if (relay) {
    await processRelay(relay);
    return 'relay';
  }

  await delay();
  return 'idle';
}

export async function runWorkerLoop(options) {
  while (!options.isStopping()) await runWorkerIteration(options);
}
