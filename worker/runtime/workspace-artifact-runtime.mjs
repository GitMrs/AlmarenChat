import { randomUUID } from 'node:crypto';
import {
  describeWorkspaceArtifact,
  diffWorkspaceSnapshots,
  executeWorkspaceTool,
  snapshotWorkspace,
} from '../../lib/agent-runtime/runtime-tools.mjs';
import {
  applyWorkspaceAttempt,
  discardWorkspaceAttempt,
} from '../../lib/workspace-staging.mjs';

export function createWorkspaceArtifactRuntime({
  db,
  projectRoot,
  addEvent,
  now = () => new Date().toISOString(),
}) {
  function taskWorkspaceOptions(run, task) {
    return {
      projectRoot,
      userId: run.userId,
      spaceId: run.spaceId,
      taskId: task.id,
      attempt: task.attempt,
    };
  }

  async function registerWorkspaceFile(run, task, relativePath) {
    const artifact = await describeWorkspaceArtifact(
      taskWorkspaceOptions(run, task),
      relativePath
    );
    const timestamp = now();
    const fileId = db.transaction(() => {
      const existing = db.prepare(
        `SELECT "id" FROM "SpaceFile" WHERE "spaceId" = ? AND "relativePath" = ? AND "runId" = ? AND "taskId" = ? ORDER BY "createdAt" DESC LIMIT 1`
      ).get(run.spaceId, artifact.relativePath, run.id, task.id);
      if (existing) {
        db.prepare(
          `UPDATE "SpaceFile" SET "fileName" = ?, "mimeType" = ?, "size" = ?, "runId" = ?, "taskId" = ?, "status" = 'GENERATING', "updatedAt" = ? WHERE "id" = ?`
        ).run(artifact.fileName, artifact.mimeType, artifact.size, run.id, task.id, timestamp, existing.id);
      } else {
        db.prepare(
          `INSERT INTO "SpaceFile" ("id", "spaceId", "fileName", "mimeType", "size", "relativePath", "runId", "taskId", "status", "createdAt", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'GENERATING', ?, ?)`
        ).run(
          artifact.id,
          run.spaceId,
          artifact.fileName,
          artifact.mimeType,
          artifact.size,
          artifact.relativePath,
          run.id,
          task.id,
          timestamp,
          timestamp
        );
      }
      db.prepare(`UPDATE "Space" SET "updatedAt" = ? WHERE "id" = ?`).run(timestamp, run.spaceId);
      return existing?.id || artifact.id;
    })();
    addEvent(run.id, 'WORKSPACE_FILE_UPDATED', `正在生成 ${artifact.fileName}`, {
      taskId: task.id,
      agentId: task.agentId,
      fileId,
      fileName: artifact.fileName,
      relativePath: artifact.relativePath,
      size: artifact.size,
      status: 'GENERATING',
    });
  }

  async function ensureTaskArtifactManifest(run, task) {
    const existing = db.prepare(
      `SELECT * FROM "AgentArtifactManifest" WHERE "taskId" = ? AND "attempt" = ?`
    ).get(task.id, task.attempt);
    if (existing) return existing;
    const baseline = await snapshotWorkspace({ projectRoot, userId: run.userId, spaceId: run.spaceId });
    const timestamp = now();
    db.prepare(
      `INSERT OR IGNORE INTO "AgentArtifactManifest"
       ("id", "runId", "taskId", "attempt", "status", "baseline", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, 'BASELINED', ?, ?, ?)`
    ).run(randomUUID(), run.id, task.id, task.attempt, JSON.stringify(baseline), timestamp, timestamp);
    return db.prepare(
      `SELECT * FROM "AgentArtifactManifest" WHERE "taskId" = ? AND "attempt" = ?`
    ).get(task.id, task.attempt);
  }

  async function recordTaskArtifactManifest(run, task, context, { validate = false, status = 'RECORDED' } = {}) {
    const manifest = await ensureTaskArtifactManifest(run, task);
    const baseline = JSON.parse(manifest.baseline);
    const after = await snapshotWorkspace(taskWorkspaceOptions(run, task));
    let entries = diffWorkspaceSnapshots(baseline, after);
    const changedPaths = entries
      .filter((entry) => ['CREATED', 'MODIFIED'].includes(entry.change))
      .map((entry) => entry.path);
    const validationFiles = [];
    const commandChecks = [];

    if (validate) {
      for (let index = 0; index < changedPaths.length; index += 50) {
        const checked = await executeWorkspaceTool(
          taskWorkspaceOptions(run, task),
          'check_files',
          { paths: changedPaths.slice(index, index + 50) }
        );
        validationFiles.push(...checked.files);
      }
      const codePaths = changedPaths.filter((relativePath) => /\.(?:[cm]?js|tsx?)$/i.test(relativePath));
      if (codePaths.length > 20) {
        commandChecks.push({ ok: false, error: '单个步骤需要语法检查的代码文件超过 20 个' });
      } else {
        for (const relativePath of codePaths) {
          const check = /\.tsx?$/i.test(relativePath) ? 'typescript' : 'javascript';
          commandChecks.push(await executeWorkspaceTool(
            taskWorkspaceOptions(run, task),
            'run_check',
            { check, path: relativePath }
          ));
        }
      }
    }

    const validationByPath = new Map(validationFiles.map((file) => [file.path, file]));
    entries = entries.map((entry) => {
      const checked = validationByPath.get(entry.path);
      return checked ? { ...entry, valid: checked.valid, issues: checked.issues } : entry;
    });
    const validation = {
      valid: validationFiles.every((file) => file.valid) && commandChecks.every((check) => check.ok),
      files: validationFiles,
      checks: commandChecks,
      issues: commandChecks.filter((check) => !check.ok).map((check) => (
        check.error || `${check.path || '代码文件'} 语法检查失败${check.stderr ? `：${String(check.stderr).slice(0, 500)}` : ''}`
      )),
    };
    const manifestStatus = validate ? (validation.valid ? 'VALIDATED' : 'INCOMPLETE') : status;
    const timestamp = now();
    db.prepare(
      `UPDATE "AgentArtifactManifest"
       SET "status" = ?, "entries" = ?, "validation" = ?, "completedAt" = ?, "updatedAt" = ?
       WHERE "id" = ?`
    ).run(manifestStatus, JSON.stringify(entries), JSON.stringify(validation), timestamp, timestamp, manifest.id);

    for (const relativePath of changedPaths) {
      context.touchedPaths.add(relativePath);
      await registerWorkspaceFile(run, task, relativePath);
    }
    if (changedPaths.length > 0) {
      const placeholders = changedPaths.map(() => '?').join(', ');
      db.prepare(
        `DELETE FROM "SpaceFile" WHERE "taskId" = ? AND "status" IN ('GENERATING', 'WAITING_APPROVAL') AND "relativePath" NOT IN (${placeholders})`
      ).run(task.id, ...changedPaths.map((relativePath) => `workspace/${relativePath}`));
    } else {
      db.prepare(
        `DELETE FROM "SpaceFile" WHERE "taskId" = ? AND "status" IN ('GENERATING', 'WAITING_APPROVAL')`
      ).run(task.id);
    }
    const summary = {
      created: entries.filter((entry) => entry.change === 'CREATED').length,
      modified: entries.filter((entry) => entry.change === 'MODIFIED').length,
      deleted: entries.filter((entry) => entry.change === 'DELETED').length,
    };
    addEvent(run.id, 'ARTIFACT_MANIFEST_RECORDED', `${task.agentName}的工作区差异已记录`, {
      taskId: task.id,
      agentId: task.agentId,
      attempt: task.attempt,
      status: manifestStatus,
      summary,
      entries,
      validation,
    });
    return { entries, validation, status: manifestStatus };
  }

  async function applyAcceptedTaskWorkspace(run, task, manifest) {
    if (!manifest && task.mode === 'advisor') return;
    if (manifest?.status === 'APPLIED') {
      await discardWorkspaceAttempt(taskWorkspaceOptions(run, task));
      return;
    }
    if (!manifest || manifest.status !== 'VALIDATED') throw new Error('协调者无法验收：工作区产物尚未通过检查');
    const baseline = JSON.parse(manifest.baseline || '{"files":[]}');
    const entries = JSON.parse(manifest.entries || '[]');
    const options = taskWorkspaceOptions(run, task);
    db.prepare(`UPDATE "AgentArtifactManifest" SET "status" = 'APPLYING', "updatedAt" = ? WHERE "id" = ?`).run(now(), manifest.id);
    let application;
    try {
      application = await applyWorkspaceAttempt(options, baseline, entries);
    } catch (error) {
      db.prepare(`UPDATE "AgentArtifactManifest" SET "status" = 'VALIDATED', "updatedAt" = ? WHERE "id" = ?`).run(now(), manifest.id);
      throw error;
    }
    try {
      const timestamp = now();
      db.transaction(() => {
        const staged = db.prepare(`SELECT "id" FROM "SpaceFile" WHERE "spaceId" = ? AND "runId" = ? AND "taskId" = ?`).all(run.spaceId, run.id, task.id);
        const stagedIds = new Set(staged.map((file) => file.id));
        for (const entry of entries) {
          const relativePath = `workspace/${entry.path}`;
          if (entry.change === 'DELETED') {
            db.prepare(`DELETE FROM "SpaceFile" WHERE "spaceId" = ? AND "relativePath" = ?`).run(run.spaceId, relativePath);
          } else {
            for (const duplicate of db.prepare(`SELECT "id" FROM "SpaceFile" WHERE "spaceId" = ? AND "relativePath" = ?`).all(run.spaceId, relativePath)) {
              if (!stagedIds.has(duplicate.id)) db.prepare(`DELETE FROM "SpaceFile" WHERE "id" = ?`).run(duplicate.id);
            }
          }
        }
        db.prepare(`UPDATE "SpaceFile" SET "status" = 'READY', "updatedAt" = ? WHERE "spaceId" = ? AND "runId" = ? AND "taskId" = ?`).run(timestamp, run.spaceId, run.id, task.id);
        db.prepare(`UPDATE "AgentArtifactManifest" SET "status" = 'APPLIED', "completedAt" = ?, "updatedAt" = ? WHERE "id" = ?`).run(timestamp, timestamp, manifest.id);
      })();
    } catch (error) {
      await application.rollback();
      db.prepare(`UPDATE "AgentArtifactManifest" SET "status" = 'VALIDATED', "updatedAt" = ? WHERE "id" = ?`).run(now(), manifest.id);
      throw error;
    }
    await discardWorkspaceAttempt(options);
    const webpagePaths = entries
      .filter((entry) => entry.change !== 'DELETED' && /\.html?$/i.test(entry.path))
      .map((entry) => entry.path);
    if (webpagePaths.length > 0) {
      addEvent(run.id, 'WEBPAGE_PREVIEW_READY', '页面文件已通过静态检查，可打开预览', {
        taskId: task.id,
        agentId: task.agentId,
        attempt: task.attempt,
        actor: 'system',
        paths: webpagePaths,
      }, `webpage-preview-ready:${task.id}:${task.attempt}`);
    }
  }

  return {
    applyAcceptedTaskWorkspace,
    ensureTaskArtifactManifest,
    recordTaskArtifactManifest,
    registerWorkspaceFile,
    taskWorkspaceOptions,
  };
}
