function normalizedReference(value) {
  try {
    return decodeURIComponent(String(value || '')).replaceAll('\\', '/').replace(/^\.\//, '');
  } catch {
    return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
  }
}

export function resolveWechatArticleImage(reference, files) {
  const normalized = normalizedReference(reference);
  if (!normalized) throw new Error('公众号正文包含空图片地址');
  if (/^(?:https?:|data:|blob:|\/)/i.test(normalized)) {
    throw new Error('公众号草稿暂不支持外部或内联图片，请先上传到空间');
  }
  if (normalized.split('/').includes('..')) throw new Error(`正文图片路径不安全：${reference}`);
  const file = files.find((candidate) => {
    const stored = String(candidate.relativePath || '').replaceAll('\\', '/');
    return normalized === stored || normalized === candidate.fileName || stored.endsWith(`/${normalized}`);
  });
  if (!file) throw new Error(`正文图片不存在：${reference}`);
  if (!String(file.mimeType || '').startsWith('image/')) throw new Error(`正文引用的文件不是图片：${file.fileName}`);
  return file;
}

export function selectAutomatedWechatDraftFiles(files, workId) {
  const workFiles = files.filter((file) => file.workId === workId && file.status === 'READY');
  const articles = workFiles.filter((file) => isWechatPublishableMarkdownFile(file.fileName));
  if (articles.length === 0) throw new Error('当前成果没有可发布的 Markdown 正文');
  if (articles.length > 1) throw new Error('当前成果包含多篇可发布正文，无法自动判断要发布哪一篇');

  const images = workFiles.filter((file) => String(file.mimeType || '').startsWith('image/'));
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
import { isWechatPublishableMarkdownFile } from '../wechat-publishing.mjs';
