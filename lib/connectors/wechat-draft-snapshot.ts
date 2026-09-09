import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { renderWechatArticleSnapshot } from '@/lib/connectors/wechat-article-snapshot.mjs';
import { selectAutomatedWechatDraftFiles, wechatDraftSnapshotHash } from '@/lib/connectors/wechat-article-policy.mjs';

export { selectAutomatedWechatDraftFiles } from '@/lib/connectors/wechat-article-policy.mjs';

export const MAX_WECHAT_ARTICLE_BYTES = 1024 * 1024;

type SnapshotFile = {
  id: string;
  fileName: string;
  relativePath: string;
  mimeType?: string | null;
  size?: number | null;
  status?: string;
  workId?: string | null;
  runId?: string | null;
};

async function readRootFile(root: string, file: SnapshotFile) {
  const target = path.resolve(root, file.relativePath);
  const [actualRoot, actualTarget] = await Promise.all([realpath(root), realpath(target)]);
  if (actualTarget !== actualRoot && !actualTarget.startsWith(actualRoot + path.sep)) throw new Error('文件路径无效');
  const info = await stat(actualTarget);
  if (!info.isFile()) throw new Error(`文件不存在：${file.fileName}`);
  return readFile(actualTarget);
}

function fileSnapshot(file: SnapshotFile, bytes: Buffer) {
  return {
    fileId: file.id,
    fileName: file.fileName,
    relativePath: file.relativePath,
    mimeType: file.mimeType,
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

export async function buildWechatDraftSnapshot({
  root,
  articleFile,
  coverFile,
  availableFiles,
  themeId,
}: {
  root: string;
  articleFile: SnapshotFile;
  coverFile: SnapshotFile;
  availableFiles: SnapshotFile[];
  themeId?: string;
}) {
  const articleBytes = await readRootFile(root, articleFile);
  if (articleBytes.byteLength > MAX_WECHAT_ARTICLE_BYTES) throw new Error('公众号文章不能超过 1MB');
  const markdown = new TextDecoder('utf-8', { fatal: true }).decode(articleBytes);
  const rendered = renderWechatArticleSnapshot(markdown, availableFiles, themeId);
  const assetFiles = [...new Map([coverFile, ...rendered.embeddedFiles].map((file) => [file.id, file])).values()];
  const assetSnapshots = await Promise.all(assetFiles.map(async (file) => fileSnapshot(file, await readRootFile(root, file))));
  const snapshotHash = wechatDraftSnapshotHash({ title: rendered.title, html: rendered.html, assets: assetSnapshots });
  return {
    provider: 'WECHAT_OFFICIAL_ACCOUNT',
    snapshotHash,
    article: {
      title: rendered.title,
      html: rendered.html,
      articleFile: fileSnapshot(articleFile, articleBytes),
      coverFileId: coverFile.id,
      assets: assetSnapshots,
    },
  };
}
