import { randomUUID } from 'node:crypto';

const ACTIVE_RUN_STATUSES = ['QUEUED', 'PLANNING', 'RUNNING', 'WAITING', 'WAITING_APPROVAL'];
const ACTIVE_DISCUSSION_STATUSES = ['QUEUED', 'RUNNING', 'WAITING_RESEARCH', 'PAUSE_REQUESTED', 'PAUSED'];
const ACTIVE_RELAY_STATUSES = ['QUEUED', 'RUNNING', 'PAUSE_REQUESTED', 'WAITING_APPROVAL', 'PAUSED'];

// 默认群聊静默 6 小时触发搭话
const DEFAULT_IDLE_SILENCE_MS = 6 * 60 * 60 * 1000;
const MIN_CHECK_INTERVAL_MS = 3 * 60 * 1000; // 最短每 3 分钟巡检一次

export function createIdleTalkRuntime({
  db,
  completeMessage,
  loadRunContext,
  now = () => new Date().toISOString(),
  silenceThresholdMs = DEFAULT_IDLE_SILENCE_MS,
}) {
  let lastCheckedAt = 0;

  async function checkAndTriggerIdleTalk() {
    const nowTime = Date.now();
    if (nowTime - lastCheckedAt < MIN_CHECK_INTERVAL_MS) return;
    lastCheckedAt = nowTime;

    try {
      const spaces = db.prepare('SELECT "id", "userId", "name", "description", "instructions", "discussionSettings" FROM "Space" WHERE "discussionSettings" IS NOT NULL').all();
      if (!spaces.length) return;

      for (const space of spaces) {
        let settings;
        try {
          settings = typeof space.discussionSettings === 'string'
            ? JSON.parse(space.discussionSettings)
            : space.discussionSettings;
        } catch {
          continue;
        }

        if (!settings?.idleTalk) continue;

        // 1. 检查空间是否有正在进行的任务、讨论或接力
        const hasActiveRun = Boolean(
          db.prepare(`SELECT 1 FROM "AgentRun" WHERE "spaceId" = ? AND "status" IN (${ACTIVE_RUN_STATUSES.map(() => '?').join(',')}) LIMIT 1`).get(space.id, ...ACTIVE_RUN_STATUSES)
        );
        if (hasActiveRun) continue;

        const hasActiveDiscussion = Boolean(
          db.prepare(`SELECT 1 FROM "SpaceDiscussion" WHERE "spaceId" = ? AND "status" IN (${ACTIVE_DISCUSSION_STATUSES.map(() => '?').join(',')}) LIMIT 1`).get(space.id, ...ACTIVE_DISCUSSION_STATUSES)
        );
        if (hasActiveDiscussion) continue;

        const hasActiveRelay = Boolean(
          db.prepare(`SELECT 1 FROM "SpaceRelay" WHERE "spaceId" = ? AND "status" IN (${ACTIVE_RELAY_STATUSES.map(() => '?').join(',')}) LIMIT 1`).get(space.id, ...ACTIVE_RELAY_STATUSES)
        );
        if (hasActiveRelay) continue;

        // 2. 检查空间最后一条消息
        const lastMsg = db.prepare('SELECT * FROM "SpaceMessage" WHERE "spaceId" = ? ORDER BY "createdAt" DESC LIMIT 1').get(space.id);
        if (!lastMsg) continue; // 没有任何发言记录的空间不打扰

        const lastMsgTime = new Date(lastMsg.createdAt).getTime();
        if (Number.isNaN(lastMsgTime)) continue;

        // 静默时间未达到阈值
        if (nowTime - lastMsgTime < silenceThresholdMs) continue;

        // 若最后一条已经是空闲搭话，不再重复搭话刷屏
        const attachmentsStr = String(lastMsg.attachments || '');
        if (attachmentsStr.includes('idle_talk')) continue;

        // 3. 生成基于空间主题与最近上下文的主动搭话
        let context;
        try {
          context = loadRunContext({ spaceId: space.id, userId: space.userId });
        } catch (err) {
          continue;
        }

        const recentMessages = db.prepare('SELECT "role", "content", "createdAt" FROM "SpaceMessage" WHERE "spaceId" = ? ORDER BY "createdAt" DESC LIMIT 4').all(space.id).reverse();
        const recentContextText = recentMessages.map((m) => `${m.role === 'user' ? '用户' : '成员'}: ${m.content}`).join('\n');

        const promptMessages = [
          {
            role: 'system',
            content: [
              '你是空间协调者。空间成员和用户已经有较长时间没有在群聊中发言了。',
              space.name ? `当前空间名称：${space.name}` : '',
              space.description ? `空间说明：${space.description}` : '',
              space.instructions ? `空间规则：${space.instructions}` : '',
              '请结合当前空间的目标和最近上下文，主动在群聊中发起一条轻量、亲切的问候或下一步探索/讨论建议。',
              '【要求】',
              '1. 语言自然亲切，不要机械说教。',
              '2. 针对空间目标提出一个具体的开放性问题或轻量建议，激发用户和成员讨论。',
              '3. 严格控制字数在 150 字以内，不要长篇大论。',
            ].filter(Boolean).join('\n\n'),
          },
          {
            role: 'user',
            content: `最近聊天记录：\n${recentContextText || '暂无详细历史'}\n\n请发起一条主动问候或探讨建议：`,
          },
        ];

        let response;
        try {
          response = await completeMessage(context.model, promptMessages, []);
        } catch (err) {
          console.warn(`[idle-talk] 生成搭话失败 for space ${space.id}:`, err?.message);
          continue;
        }

        const replyContent = response?.content?.trim();
        if (!replyContent) continue;

        const timestamp = now();
        const messageId = randomUUID();
        db.prepare(
          `INSERT INTO "SpaceMessage" ("id", "spaceId", "role", "speakerAgentId", "content", "attachments", "createdAt") VALUES (?, ?, 'assistant', 'space-coordinator', ?, ?, ?)`
        ).run(
          messageId,
          space.id,
          replyContent,
          JSON.stringify([{ type: 'idle_talk', triggeredAt: timestamp }]),
          timestamp
        );
        db.prepare(`UPDATE "Space" SET "updatedAt" = ? WHERE "id" = ?`).run(timestamp, space.id);
        console.log(`[idle-talk] 触发主动搭话: 空间 ${space.name} (${space.id})`);
      }
    } catch (err) {
      console.warn('[idle-talk] 检查主动搭话时发生错误:', err?.message);
    }
  }

  return { checkAndTriggerIdleTalk };
}
