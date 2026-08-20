import {
  discardWorkspaceAttemptSync,
  recoverWorkspaceAttemptApplication,
} from '../../lib/workspace-staging.mjs';

export function createWorkspaceRecoveryRuntime({
  db,
  projectRoot,
  addEvent,
  now = () => new Date().toISOString(),
  discardAttemptSync = discardWorkspaceAttemptSync,
  recoverApplication = recoverWorkspaceAttemptApplication,
}) {
  async function recoverInterruptedWorkspaceApplications() {
    const manifests = db.prepare(
      `SELECT manifest."id", manifest."runId", manifest."taskId", manifest."attempt", manifest."baseline", manifest."entries",
              run."userId", run."spaceId"
       FROM "AgentArtifactManifest" manifest
       JOIN "AgentRun" run ON run."id" = manifest."runId"
       WHERE manifest."status" = 'APPLYING'`
    ).all();
    for (const manifest of manifests) {
      try {
        await recoverApplication(
          {
            projectRoot,
            userId: manifest.userId,
            spaceId: manifest.spaceId,
            taskId: manifest.taskId,
            attempt: manifest.attempt,
          },
          JSON.parse(manifest.baseline || '{"files":[]}'),
          JSON.parse(manifest.entries || '[]')
        );
        db.prepare(
          `UPDATE "AgentArtifactManifest" SET "status" = 'VALIDATED', "updatedAt" = ? WHERE "id" = ? AND "status" = 'APPLYING'`
        ).run(now(), manifest.id);
        addEvent(manifest.runId, 'WORKSPACE_APPLICATION_RECOVERED', '检测到中断的工作区合并，正式文件已恢复到审核前状态', {
          taskId: manifest.taskId,
          attempt: manifest.attempt,
        });
      } catch (error) {
        addEvent(manifest.runId, 'WORKSPACE_APPLICATION_RECOVERY_FAILED', '中断的工作区合并恢复失败', {
          taskId: manifest.taskId,
          attempt: manifest.attempt,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  function cleanupClosedWorkspaceAttempts() {
    const manifests = db.prepare(
      `SELECT manifest."runId", manifest."taskId", manifest."attempt", run."userId", run."spaceId"
       FROM "AgentArtifactManifest" manifest
       JOIN "AgentRun" run ON run."id" = manifest."runId"
       WHERE manifest."status" IN ('APPLIED', 'DISCARDED')`
    ).all();
    for (const manifest of manifests) {
      try {
        discardAttemptSync({
          projectRoot,
          userId: manifest.userId,
          spaceId: manifest.spaceId,
          taskId: manifest.taskId,
          attempt: manifest.attempt,
        });
      } catch (error) {
        addEvent(manifest.runId, 'WORKSPACE_STAGING_CLEANUP_FAILED', '历史任务暂存区清理失败', {
          taskId: manifest.taskId,
          attempt: manifest.attempt,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  function discardTaskWorkspace(runId, taskId) {
    const task = db.prepare(
      `SELECT task."id", task."attempt", run."userId", run."spaceId"
       FROM "AgentTask" task JOIN "AgentRun" run ON run."id" = task."runId"
       WHERE task."id" = ? AND task."runId" = ?`
    ).get(taskId, runId);
    if (!task) return;
    try {
      discardAttemptSync({
        projectRoot,
        userId: task.userId,
        spaceId: task.spaceId,
        taskId: task.id,
        attempt: task.attempt,
      });
    } catch (error) {
      addEvent(runId, 'WORKSPACE_STAGING_CLEANUP_FAILED', '任务暂存区清理失败', {
        taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  function restoreTouchedPaths(runId, target, visited = new Set()) {
    if (!runId || visited.has(runId)) return;
    visited.add(runId);
    const run = db.prepare('SELECT "retryOfId" FROM "AgentRun" WHERE "id" = ?').get(runId);
    if (run?.retryOfId) restoreTouchedPaths(run.retryOfId, target, visited);
    const events = db.prepare(
      `SELECT "payload" FROM "AgentRunEvent" WHERE "runId" = ? AND "type" = 'TOOL_COMPLETED' ORDER BY "createdAt" ASC`
    ).all(runId);
    for (const event of events) {
      try {
        const payload = JSON.parse(event.payload || '{}');
        if (['write_file', 'patch_file'].includes(payload.tool) && payload.path) target.add(String(payload.path));
        if (payload.tool === 'patch_files') {
          for (const relativePath of payload.paths || []) target.add(String(relativePath));
        }
        if (payload.tool === 'check_files' && payload.valid && Array.isArray(payload.paths)) {
          for (const filePath of payload.paths) target.add(String(filePath));
        }
      } catch {
        // Malformed legacy audit payloads do not stop run recovery.
      }
    }
    const manifests = db.prepare(
      `SELECT "entries" FROM "AgentArtifactManifest" WHERE "runId" = ? AND "entries" IS NOT NULL ORDER BY "createdAt" ASC`
    ).all(runId);
    for (const manifest of manifests) {
      try {
        for (const entry of JSON.parse(manifest.entries || '[]')) {
          if (['CREATED', 'MODIFIED'].includes(entry.change) && entry.path) target.add(String(entry.path));
        }
      } catch {
        // Malformed legacy manifests do not stop run recovery.
      }
    }
  }

  return {
    cleanupClosedWorkspaceAttempts,
    discardTaskWorkspace,
    recoverInterruptedWorkspaceApplications,
    restoreTouchedPaths,
  };
}
