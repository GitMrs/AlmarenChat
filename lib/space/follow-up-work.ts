import { executeWorkspaceTool, workspaceToolSchemas } from '../agents/runtime/runtime-tools.mjs';
import { logicalWorkspaceRelativePath } from './space-work-paths.mjs';

const READ_TOOLS = new Set(['list_files', 'read_file']);

export async function prepareFollowUpWork(db: any, task: any) {
  if (!task.workId) {
    if (task.workTitle != null) throw new Error('关联成果已删除，本轮跟进已失去目标');
    return { context: '', tools: [], execute: async () => { throw new Error('本轮未关联成果'); } };
  }
  const work = await db.spaceWork.findFirst({ where: { id: task.workId, spaceId: task.spaceId },
    select: { id: true, title: true, objective: true, status: true, stage: true, updatedAt: true,
      files: { select: { fileName: true, relativePath: true, updatedAt: true }, take: 50 } } });
  if (!work) throw new Error('关联成果不存在或已不属于当前空间');
  const files = work.files.map((file: any) => ({ fileName: file.fileName,
    path: logicalWorkspaceRelativePath(work.id, file.relativePath), updatedAt: file.updatedAt }));
  return {
    context: `【本次关联成果的最新状态】\n${JSON.stringify({ ...work, files })}\n这是成果状态与文件目录，不能代替正文证据。请使用 list_files/read_file 核验相关内容；这些工具只读。`,
    tools: workspaceToolSchemas.filter((tool: any) => READ_TOOLS.has(tool.function.name)),
    execute: async (name: string, args: any, signal: AbortSignal) => {
      if (!READ_TOOLS.has(name)) throw new Error('自主跟进只能读取关联成果');
      const result = await executeWorkspaceTool({ projectRoot: process.cwd(), userId: task.space.userId,
        spaceId: task.spaceId, workId: task.workId, isCancelled: () => signal.aborted }, name, args);
      if (name === 'read_file' && typeof result.content === 'string' && result.content.length > 16_000) {
        result.content = result.content.slice(0, 16_000);
        result.nextOffset = result.offset + result.content.length;
        result.hasMore = result.nextOffset < result.totalChars;
      }
      return result;
    },
  };
}
