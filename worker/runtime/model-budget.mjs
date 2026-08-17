function budgetError(message) {
  const error = new Error(message);
  error.code = 'MODEL_REQUEST_BUDGET';
  return error;
}

export function reserveModelRequest(db, runId, taskId = null, timestamp = new Date().toISOString()) {
  return db.transaction(() => {
    const run = db.prepare(
      `SELECT "modelRequestCount", "modelRequestLimit" FROM "AgentRun" WHERE "id" = ?`
    ).get(runId);
    if (!run) throw new Error('任务不存在');
    if (run.modelRequestCount >= run.modelRequestLimit) {
      throw budgetError(`任务模型调用已达到 ${run.modelRequestLimit} 次上限，需要用户明确重试后才能继续`);
    }
    let task = null;
    if (taskId) {
      task = db.prepare(
        `SELECT "modelRequestCount", "modelRequestLimit" FROM "AgentTask" WHERE "id" = ? AND "runId" = ?`
      ).get(taskId, runId);
      if (!task) throw new Error('执行步骤不存在');
      if (task.modelRequestCount >= task.modelRequestLimit) {
        throw budgetError(`当前步骤模型调用已达到 ${task.modelRequestLimit} 次上限，需要用户明确重试后才能继续`);
      }
      db.prepare(
        `UPDATE "AgentTask" SET "modelRequestCount" = "modelRequestCount" + 1, "updatedAt" = ? WHERE "id" = ?`
      ).run(timestamp, taskId);
    }
    db.prepare(
      `UPDATE "AgentRun" SET "modelRequestCount" = "modelRequestCount" + 1, "updatedAt" = ? WHERE "id" = ?`
    ).run(timestamp, runId);
    return {
      runCount: run.modelRequestCount + 1,
      runLimit: run.modelRequestLimit,
      taskCount: task ? task.modelRequestCount + 1 : null,
      taskLimit: task?.modelRequestLimit || null,
    };
  })();
}
