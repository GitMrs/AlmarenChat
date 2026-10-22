import fs from 'node:fs';
import path from 'node:path';

/**
 * 确认并将暂存区的待发 ID 合并至历史排重库 sent-history.txt 并清理暂存
 * @param {Object} options
 * @param {string} [options.projectRoot]
 * @param {string} options.userId
 * @param {string} options.spaceId
 */
export function commitSpacePendingHistory({ projectRoot = process.cwd(), userId, spaceId }) {
  try {
    if (!userId || !spaceId) return { committedCount: 0 };
    const workspaceBase = path.resolve(projectRoot, 'data', 'spaces', userId, spaceId, 'workspace', 'shared');
    const pendingPath = path.resolve(workspaceBase, 'pending-ids.txt');
    const historyPath = path.resolve(workspaceBase, 'sent-history.txt');

    if (!fs.existsSync(pendingPath)) return { committedCount: 0 };

    const rawPending = fs.readFileSync(pendingPath, 'utf-8');
    const idsToCommit = rawPending
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));

    if (idsToCommit.length > 0) {
      const existingHistory = fs.existsSync(historyPath)
        ? fs.readFileSync(historyPath, 'utf-8')
        : '';
      const existingSet = new Set(
        existingHistory
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
      );

      const brandNewIds = idsToCommit.filter((id) => !existingSet.has(id));
      if (brandNewIds.length > 0) {
        const toAppend = brandNewIds.join('\n') + '\n';
        fs.appendFileSync(historyPath, toAppend, 'utf-8');
      }
    }

    // 清理暂存区
    try {
      fs.unlinkSync(pendingPath);
    } catch {
      // 忽略文件并发或已删除错误
    }

    return { committedCount: idsToCommit.length };
  } catch (err) {
    console.error('[commitSpacePendingHistory] error:', err);
    return { committedCount: 0, error: err?.message };
  }
}
