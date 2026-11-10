import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { renderWechatArticleSnapshot } from '@/lib/workspace/wechat/wechat-article-snapshot.mjs';
import { selectAutomatedWechatDraftFiles, wechatDraftSnapshotHash } from '@/lib/workspace/wechat/wechat-article-policy.mjs';
import { normalizeWechatPublishingSettings, validateWechatArticle } from '@/lib/workspace/wechat/wechat-publishing-validation.mjs';

export { selectAutomatedWechatDraftFiles } from '@/lib/workspace/wechat/wechat-article-policy.mjs';

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
  publishingSettings,
}: {
  root: string;
  articleFile: SnapshotFile;
  coverFile: SnapshotFile;
  availableFiles: SnapshotFile[];
  themeId?: string;
  publishingSettings?: any;
}) {
  const articleBytes = await readRootFile(root, articleFile);
  if (articleBytes.byteLength > MAX_WECHAT_ARTICLE_BYTES) throw new Error('公众号文章不能超过 1MB');
  const markdown = new TextDecoder('utf-8', { fatal: true }).decode(articleBytes);
  if (coverFile.workId && coverFile.workId !== articleFile.workId) throw new Error('封面必须属于当前文章或空间公共资料');
  const settings = normalizeWechatPublishingSettings({
    ...publishingSettings,
    coverInfo: publishingSettings?.coverFileId === coverFile.id ? publishingSettings.coverInfo : undefined,
    coverFileId: coverFile.id,
    ...(themeId ? { themeId } : {}),
  });
  const scopedFiles = availableFiles.filter((file) => !file.workId || file.workId === articleFile.workId);
  const rendered = renderWechatArticleSnapshot(markdown, scopedFiles, settings.themeId);
  validateWechatArticle({ title: rendered.title, content: rendered.html, author: settings.author, digest: settings.digest });
  const assetFiles = [...new Map([coverFile, ...rendered.embeddedFiles].map((file) => [file.id, file])).values()];
  const assetSnapshots = await Promise.all(assetFiles.map(async (file) => fileSnapshot(file, await readRootFile(root, file))));
  const snapshotHash = wechatDraftSnapshotHash({ title: rendered.title, html: rendered.html, assets: assetSnapshots, publishingSettings: settings });
  return {
    provider: 'WECHAT_OFFICIAL_ACCOUNT',
    snapshotHash,
    article: {
      ...settings,
      title: rendered.title,
      html: rendered.html,
      articleFile: fileSnapshot(articleFile, articleBytes),
      coverFileId: coverFile.id,
      assets: assetSnapshots,
    },
  };
}
