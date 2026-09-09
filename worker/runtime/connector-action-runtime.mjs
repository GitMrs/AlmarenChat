import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { createWechatOfficialAccountConnector } from '../../lib/connectors/wechat-official-account.mjs';
import { createEncryptedConnectorTokenCache, readWechatConnectorCredentials } from '../../lib/connectors/store.mjs';
import { classifyWechatPublicationStatus, MAX_WECHAT_PUBLICATION_POLLS, wechatPublicationPollDelayMs } from '../../lib/connectors/wechat-publication-policy.mjs';

function json(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function message(db, { spaceId, content, actionId, kind, timestamp }) {
  db.prepare(
    `INSERT OR IGNORE INTO "SpaceMessage"
     ("id", "spaceId", "role", "speakerAgentId", "content", "attachments", "sourceKey", "createdAt")
     VALUES (?, ?, 'assistant', 'space-coordinator', ?, ?, ?, ?)`
  ).run(
    randomUUID(), spaceId, content,
    JSON.stringify([{ type: 'connector_action', actionId, kind }]),
    `connector-action:${actionId}:${kind}`, timestamp
  );
}

async function verifiedFile(projectRoot, execution, snapshot) {
  if (!snapshot?.relativePath || !snapshot?.sha256) throw new Error('发布快照缺少文件校验信息');
  const root = path.resolve(projectRoot, 'data', 'spaces', execution.userId, execution.spaceId);
  const target = path.resolve(root, snapshot.relativePath);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('发布快照文件路径无效');
  const [actualRoot, actualTarget] = await Promise.all([realpath(root), realpath(target)]);
  if (actualTarget !== actualRoot && !actualTarget.startsWith(actualRoot + path.sep)) throw new Error('发布快照文件路径无效');
  const info = await stat(actualTarget);
  if (!info.isFile() || info.size !== snapshot.size) throw new Error(`文件在审批后发生变化：${snapshot.fileName}`);
  const bytes = await readFile(actualTarget);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== snapshot.sha256) throw new Error(`文件在审批后发生变化：${snapshot.fileName}`);
  return bytes;
}

function claimNextConnectorExecution(db, timestamp) {
  return db.transaction(() => {
    const execution = db.prepare(
      `SELECT execution.*, action."spaceId", action."workId", action."payload",
              space."userId", connector."provider", connector."publicConfig", connector."credentialCiphertext",
              connector."accessTokenCiphertext", connector."accessTokenExpiresAt"
       FROM "SpaceConnectorExecution" execution
       JOIN "SpaceActionRequest" action ON action."id" = execution."actionRequestId"
       JOIN "SpaceConnector" connector ON connector."id" = execution."connectorId"
       JOIN "Space" space ON space."id" = action."spaceId"
       WHERE (execution."status" = 'QUEUED' OR (execution."status" = 'WAITING_PROVIDER' AND execution."nextPollAt" <= ?))
         AND action."status" = 'APPROVED' AND connector."enabled" = 1
       ORDER BY execution."createdAt" ASC LIMIT 1`
    ).get(timestamp);
    if (!execution) return null;
    const changed = db.prepare(
      `UPDATE "SpaceConnectorExecution" SET "status" = 'RUNNING', "startedAt" = COALESCE("startedAt", ?), "updatedAt" = ?
       WHERE "id" = ? AND "status" = ?`
    ).run(timestamp, timestamp, execution.id, execution.status);
    return changed.changes === 1 ? { ...execution, claimedFromStatus: execution.status, status: 'RUNNING', startedAt: execution.startedAt || timestamp } : null;
  }).immediate();
}

export function createConnectorActionRuntime({
  db,
  projectRoot,
  now = () => new Date().toISOString(),
  connectorFactory = createWechatOfficialAccountConnector,
  connectorSecret,
  persistSpaceMemory = () => {},
}) {
  async function processConnectorExecution(execution) {
    const payload = json(execution.payload, {});
    const connectorRecord = {
      ...execution,
      publicConfig: json(execution.publicConfig, {}),
    };
    try {
      if (execution.provider !== 'WECHAT_OFFICIAL_ACCOUNT') throw new Error(`不支持的连接器：${execution.provider}`);
      const credentials = readWechatConnectorCredentials(connectorRecord, connectorSecret);
      const tokenCache = createEncryptedConnectorTokenCache({
        connector: connectorRecord,
        secret: connectorSecret,
        update: async (id, data) => db.prepare(
          `UPDATE "SpaceConnector" SET "accessTokenCiphertext" = ?, "accessTokenExpiresAt" = ?, "updatedAt" = ? WHERE "id" = ?`
        ).run(data.accessTokenCiphertext, data.accessTokenExpiresAt?.toISOString?.() || null, now(), id),
      });
      const client = connectorFactory({ ...credentials, tokenCache });
      let result;
      if (execution.operation === 'WECHAT_VALIDATE_CONNECTION') {
        result = await client.validateConnection();
      } else if (execution.operation === 'WECHAT_CREATE_DRAFT') {
        const article = payload.article;
        if (!article?.title || !article?.html || !Array.isArray(article.assets)) throw new Error('微信草稿快照不完整');
        const cover = article.assets.find((asset) => asset.fileId === article.coverFileId);
        if (!cover) throw new Error('微信草稿缺少封面快照');
        const coverUpload = await client.uploadImage({ bytes: await verifiedFile(projectRoot, execution, cover), fileName: cover.fileName, mimeType: cover.mimeType, permanent: true });
        let html = article.html;
        for (const asset of article.assets.filter((item) => item.fileId !== article.coverFileId || html.includes(`data-almaren-space-file=\"${item.fileId}\"`))) {
          if (!html.includes(`data-almaren-space-file=\"${asset.fileId}\"`)) continue;
          const upload = await client.uploadImage({ bytes: await verifiedFile(projectRoot, execution, asset), fileName: asset.fileName, mimeType: asset.mimeType, permanent: false });
          html = html.split(`data-almaren-space-file=\"${asset.fileId}\"`).join(`src=\"${upload.url}\"`);
        }
        if (html.includes('data-almaren-space-file=')) throw new Error('正文图片未全部上传到微信');
        result = await client.createDraft([{ title: article.title, content: html, thumbMediaId: coverUpload.mediaId }]);
      } else if (execution.operation === 'WECHAT_PUBLISH') {
        if (!payload.mediaId) throw new Error('微信发布请求缺少草稿 ID');
        if (!execution.externalId) {
          result = await client.publish(payload.mediaId);
          const timestamp = now();
          const nextPollAt = new Date(new Date(timestamp).getTime() + wechatPublicationPollDelayMs(0)).toISOString();
          db.transaction(() => {
            db.prepare(
              `UPDATE "SpaceConnectorExecution" SET "status" = 'WAITING_PROVIDER', "responseSummary" = ?, "externalId" = ?, "nextPollAt" = ?, "pollCount" = 0, "updatedAt" = ? WHERE "id" = ?`
            ).run(JSON.stringify({ publishId: result.publishId, submitted: true }), result.publishId, nextPollAt, timestamp, execution.id);
            db.prepare(`UPDATE "SpaceActionRequest" SET "result" = ?, "updatedAt" = ? WHERE "id" = ?`).run(JSON.stringify({ publishId: result.publishId, status: 'PROCESSING' }), timestamp, execution.actionRequestId);
            db.prepare(`UPDATE "SpaceConnector" SET "status" = 'READY', "lastCheckedAt" = ?, "lastError" = NULL, "updatedAt" = ? WHERE "id" = ?`).run(timestamp, timestamp, execution.connectorId);
            message(db, { spaceId: execution.spaceId, content: `“${payload.title || '公众号文章'}”已提交微信，正在等待平台处理。`, actionId: execution.actionRequestId, kind: 'WECHAT_PUBLISH_SUBMITTED', timestamp });
          })();
          return result;
        }
        const publication = await client.publicationStatus(execution.externalId);
        const outcome = classifyWechatPublicationStatus(publication);
        const nextPollCount = Number(execution.pollCount || 0) + 1;
        if (outcome.state === 'pending') {
          if (nextPollCount >= MAX_WECHAT_PUBLICATION_POLLS) {
            const timeout = new Error(`微信发布状态查询超过 ${MAX_WECHAT_PUBLICATION_POLLS} 次，请前往公众号后台核对结果`);
            timeout.code = 'WECHAT_PUBLICATION_TERMINAL';
            throw timeout;
          }
          const timestamp = now();
          const nextPollAt = new Date(new Date(timestamp).getTime() + wechatPublicationPollDelayMs(nextPollCount)).toISOString();
          db.prepare(
            `UPDATE "SpaceConnectorExecution" SET "status" = 'WAITING_PROVIDER', "responseSummary" = ?, "nextPollAt" = ?, "pollCount" = ?, "error" = NULL, "updatedAt" = ? WHERE "id" = ?`
          ).run(JSON.stringify(publication), nextPollAt, nextPollCount, timestamp, execution.id);
          return publication;
        }
        if (outcome.state === 'failed') {
          const failure = new Error(`微信发布失败：${outcome.message}${publication.failIndex === null ? '' : `（文章序号 ${publication.failIndex}）`}`);
          failure.code = 'WECHAT_PUBLICATION_TERMINAL';
          throw failure;
        }
        result = { ...publication, publishId: execution.externalId };
      } else {
        throw new Error(`不支持的连接器动作：${execution.operation}`);
      }
      const timestamp = now();
      db.transaction(() => {
        db.prepare(
          `UPDATE "SpaceConnectorExecution" SET "status" = 'COMPLETED', "responseSummary" = ?, "externalId" = ?, "externalUrl" = ?, "nextPollAt" = NULL, "error" = NULL, "completedAt" = ?, "updatedAt" = ? WHERE "id" = ?`
        ).run(JSON.stringify(result), result.mediaId || result.publishId || null, result.url || null, timestamp, timestamp, execution.id);
        db.prepare(
          `UPDATE "SpaceActionRequest" SET "status" = 'COMPLETED', "result" = ?, "completedAt" = ?, "updatedAt" = ? WHERE "id" = ?`
        ).run(JSON.stringify(result), timestamp, timestamp, execution.actionRequestId);
        db.prepare(
          `UPDATE "SpaceConnector" SET "status" = 'READY', "lastCheckedAt" = ?, "lastError" = NULL, "updatedAt" = ? WHERE "id" = ?`
        ).run(timestamp, timestamp, execution.connectorId);
        if (execution.operation === 'WECHAT_VALIDATE_CONNECTION') {
          message(db, { spaceId: execution.spaceId, content: '微信公众号连接验证通过。', actionId: execution.actionRequestId, kind: execution.operation, timestamp });
        } else if (execution.operation === 'WECHAT_CREATE_DRAFT') {
          const actionId = randomUUID();
          db.prepare(
            `INSERT OR IGNORE INTO "SpaceActionRequest"
             ("id", "spaceId", "workId", "kind", "riskLevel", "title", "status", "payload", "idempotencyKey", "requestedAt", "createdAt", "updatedAt")
             VALUES (?, ?, ?, 'WECHAT_PUBLISH', 'HIGH', ?, 'PENDING', ?, ?, ?, ?, ?)`
          ).run(actionId, execution.spaceId, execution.workId || null, `正式发布：${payload.article.title}`.slice(0, 160), JSON.stringify({ provider: execution.provider, mediaId: result.mediaId, title: payload.article.title }), `wechat-publish:${execution.actionRequestId}:${result.mediaId}`, timestamp, timestamp, timestamp);
          message(db, { spaceId: execution.spaceId, content: `微信草稿“${payload.article.title}”已创建，等待你另行确认是否正式发布。`, actionId, kind: 'WECHAT_PUBLISH', timestamp });
          persistSpaceMemory(execution.spaceId, [{
            type: 'external_draft_created', actor: '微信公众号连接器',
            summary: `已创建微信草稿“${payload.article.title}”，草稿 ID：${result.mediaId}，尚未正式发布。`,
            at: timestamp, refId: execution.actionRequestId,
          }], timestamp);
        } else {
          message(db, { spaceId: execution.spaceId, content: result.url ? `“${payload.title || '公众号文章'}”已通过微信发布：${result.url}` : `“${payload.title || '公众号文章'}”已通过微信发布。`, actionId: execution.actionRequestId, kind: execution.operation, timestamp });
          persistSpaceMemory(execution.spaceId, [{
            type: 'external_publication_completed', actor: '微信公众号连接器',
            summary: `已正式发布“${payload.title || '公众号文章'}”${result.url ? `：${result.url}` : '。'}`,
            at: timestamp, refId: execution.actionRequestId,
          }], timestamp);
        }
      })();
      return result;
    } catch (error) {
      const timestamp = now();
      const reason = String(error instanceof Error ? error.message : error).slice(0, 2000);
      const canRetryStatusCheck = execution.operation === 'WECHAT_PUBLISH'
        && execution.externalId
        && error?.code !== 'WECHAT_PUBLICATION_TERMINAL'
        && Number(execution.pollCount || 0) + 1 < MAX_WECHAT_PUBLICATION_POLLS;
      if (canRetryStatusCheck) {
        const nextPollCount = Number(execution.pollCount || 0) + 1;
        const nextPollAt = new Date(new Date(timestamp).getTime() + wechatPublicationPollDelayMs(nextPollCount)).toISOString();
        db.prepare(
          `UPDATE "SpaceConnectorExecution" SET "status" = 'WAITING_PROVIDER', "nextPollAt" = ?, "pollCount" = ?, "error" = ?, "updatedAt" = ? WHERE "id" = ?`
        ).run(nextPollAt, nextPollCount, reason, timestamp, execution.id);
        return null;
      }
      db.transaction(() => {
        db.prepare(`UPDATE "SpaceConnectorExecution" SET "status" = 'FAILED', "error" = ?, "completedAt" = ?, "updatedAt" = ? WHERE "id" = ?`).run(reason, timestamp, timestamp, execution.id);
        db.prepare(`UPDATE "SpaceActionRequest" SET "status" = 'FAILED', "error" = ?, "completedAt" = ?, "updatedAt" = ? WHERE "id" = ?`).run(reason, timestamp, timestamp, execution.actionRequestId);
        db.prepare(`UPDATE "SpaceConnector" SET "status" = 'ERROR', "lastCheckedAt" = ?, "lastError" = ?, "updatedAt" = ? WHERE "id" = ?`).run(timestamp, reason, timestamp, execution.connectorId);
        message(db, { spaceId: execution.spaceId, content: `外部动作执行失败：${reason}`, actionId: execution.actionRequestId, kind: execution.operation, timestamp });
        if (execution.operation !== 'WECHAT_VALIDATE_CONNECTION') {
          persistSpaceMemory(execution.spaceId, [{
            type: 'external_action_failed', actor: '微信公众号连接器',
            summary: `${execution.operation === 'WECHAT_PUBLISH' ? '正式发布' : '草稿创建'}失败：${reason}`,
            at: timestamp, refId: execution.actionRequestId,
          }], timestamp);
        }
      })();
      return null;
    }
  }

  function recoverInterruptedConnectorExecutions() {
    const timestamp = now();
    const interrupted = db.prepare(`SELECT "id", "actionRequestId", "connectorId", "operation", "externalId" FROM "SpaceConnectorExecution" WHERE "status" = 'RUNNING'`).all();
    for (const item of interrupted) {
      if (item.operation === 'WECHAT_VALIDATE_CONNECTION') {
        db.prepare(`UPDATE "SpaceConnectorExecution" SET "status" = 'QUEUED', "updatedAt" = ? WHERE "id" = ?`).run(timestamp, item.id);
        continue;
      }
      if (item.operation === 'WECHAT_PUBLISH' && item.externalId) {
        db.prepare(`UPDATE "SpaceConnectorExecution" SET "status" = 'WAITING_PROVIDER', "nextPollAt" = ?, "updatedAt" = ? WHERE "id" = ?`).run(timestamp, timestamp, item.id);
        continue;
      }
      const reason = 'Worker 在外部请求期间中断，执行结果未知；为避免重复操作，系统不会自动重试。';
      db.transaction(() => {
        db.prepare(`UPDATE "SpaceConnectorExecution" SET "status" = 'FAILED', "error" = ?, "completedAt" = ?, "updatedAt" = ? WHERE "id" = ?`).run(reason, timestamp, timestamp, item.id);
        db.prepare(`UPDATE "SpaceActionRequest" SET "status" = 'FAILED', "error" = ?, "completedAt" = ?, "updatedAt" = ? WHERE "id" = ?`).run(reason, timestamp, timestamp, item.actionRequestId);
        db.prepare(`UPDATE "SpaceConnector" SET "status" = 'ERROR', "lastError" = ?, "updatedAt" = ? WHERE "id" = ?`).run(reason, timestamp, item.connectorId);
      })();
    }
    return interrupted.length;
  }

  return {
    claimNextConnectorExecution: () => claimNextConnectorExecution(db, now()),
    processConnectorExecution,
    recoverInterruptedConnectorExecutions,
  };
}
