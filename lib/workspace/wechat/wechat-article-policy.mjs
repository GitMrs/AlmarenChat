export { resolveWechatArticleImage } from './wechat-article-images.mjs';

export function selectAutomatedWechatDraftFiles(files, workId, publishingSettings = {}) {
  const workFiles = files.filter((file) => file.workId === workId && file.status === 'READY');
  const articles = workFiles.filter((file) => isWechatPublishableMarkdownFile(file.fileName));
  if (articles.length === 0) throw new Error('当前成果没有可发布的 Markdown 正文');
  if (articles.length > 1) throw new Error('当前成果包含多篇可发布正文，无法自动判断要发布哪一篇');

  const images = workFiles.filter((file) => String(file.mimeType || '').startsWith('image/'));
  if (publishingSettings?.coverFileId) {
    const cover = files.find((file) => file.id === publishingSettings.coverFileId && file.status === 'READY' && (!file.workId || file.workId === workId) && String(file.mimeType || '').startsWith('image/'));
    if (!cover) throw new Error('已选择的文章封面不可用，请重新选择');
    return { articleFile: articles[0], coverFile: cover, workFiles };
  }
  const namedCovers = images.filter((file) => /(?:cover|thumb|封面)/i.test(file.fileName));
  if (namedCovers.length > 1) throw new Error('当前成果包含多张明确命名的封面，无法自动选择');
  if (namedCovers.length === 1) return { articleFile: articles[0], coverFile: namedCovers[0], workFiles };
  if (images.length === 0) throw new Error('当前成果缺少封面图片');
  if (images.length > 1) throw new Error('当前成果包含多张图片，请将唯一封面文件名标记为 cover 或“封面”');
  return { articleFile: articles[0], coverFile: images[0], workFiles };
}

export function wechatDraftSnapshotHash(snapshot) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
import { createHash } from 'node:crypto';
import { isWechatPublishableMarkdownFile } from './wechat-publishing.mjs';
