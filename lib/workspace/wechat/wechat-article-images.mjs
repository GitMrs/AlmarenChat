export function resolveWechatArticleImage(reference, files) {
  let normalized;
  try { normalized = decodeURIComponent(String(reference || '')); }
  catch { normalized = String(reference || ''); }
  normalized = normalized.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized) throw new Error('公众号正文包含空图片地址');
  if (/^(?:https?:|data:|blob:|\/)/i.test(normalized)) throw new Error('公众号草稿暂不支持外部或内联图片，请先上传到空间');
  if (normalized.split('/').includes('..')) throw new Error(`正文图片路径不安全：${reference}`);
  const matches = files.filter((candidate) => {
    const stored = String(candidate.relativePath || '').replaceAll('\\', '/');
    return normalized === stored || normalized === candidate.fileName || stored.endsWith(`/${normalized}`);
  });
  if (!matches.length) throw new Error(`正文图片不存在：${reference}`);
  if (matches.length > 1) throw new Error(`正文图片名称重复，请使用完整的文章或共享路径：${reference}`);
  const file = matches[0];
  if (!String(file.mimeType || '').startsWith('image/')) throw new Error(`正文引用的文件不是图片：${file.fileName}`);
  return file;
}
