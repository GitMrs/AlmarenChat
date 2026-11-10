import { WECHAT_PUBLISHING_THEMES } from './wechat-publishing-themes.mjs';

export class WechatPublishingValidationError extends Error {
  constructor(message) { super(message); this.name = 'WechatPublishingValidationError'; this.code = 'INVALID_INPUT'; }
}

function boundedText(value, label, maximum) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (Array.from(text).length > maximum) throw new WechatPublishingValidationError(`${label}不能超过 ${maximum} 字`);
  return text;
}

export function validateWechatArticle({ title, content, author = '', digest = '' }) {
  const normalized = {
    title: boundedText(title, '文章标题', 32),
    author: boundedText(author, '作者', 16),
    digest: boundedText(digest, '摘要', 120),
  };
  if (!normalized.title) throw new WechatPublishingValidationError('文章标题不能为空');
  if (!String(content || '').trim()) throw new WechatPublishingValidationError('文章正文不能为空');
  if (Array.from(content).length >= 20000) throw new WechatPublishingValidationError('最终 HTML 必须少于 20000 个字符，请精简正文或排版');
  if (new TextEncoder().encode(content).byteLength >= 1024 * 1024) throw new WechatPublishingValidationError('最终 HTML 必须小于 1MB');
  return normalized;
}

export function normalizeWechatPublishingSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new WechatPublishingValidationError('发布资料格式无效');
  const contentSourceUrl = String(input.contentSourceUrl || '').trim();
  if (contentSourceUrl) {
    let url;
    try { url = new URL(contentSourceUrl); } catch { throw new WechatPublishingValidationError('原文链接必须是有效的 HTTP 或 HTTPS 地址'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new WechatPublishingValidationError('原文链接必须是有效的 HTTP 或 HTTPS 地址');
  }
  for (const key of ['openComment', 'fansOnlyComment']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new WechatPublishingValidationError('评论设置必须是开关值');
  const coverFileId = String(input.coverFileId || '');
  if (coverFileId && !/^[a-zA-Z0-9_-]+$/.test(coverFileId)) throw new WechatPublishingValidationError('封面标识无效');
  const themeId = input.themeId || 'fresh-green';
  if (!WECHAT_PUBLISHING_THEMES.some((theme) => theme.id === themeId)) throw new WechatPublishingValidationError('公众号排版主题无效');
  const crops = input.coverInfo?.crop_percent_list;
  if (crops !== undefined && !coverFileId) throw new WechatPublishingValidationError('封面裁剪必须关联已选择的封面');
  if (crops !== undefined && (!Array.isArray(crops) || crops.length !== 2)) throw new WechatPublishingValidationError('封面须同时提供宽图和方图裁剪');
  const ratios = new Set();
  const normalizedCrops = (crops || []).map((crop) => {
    if (!crop || !['2.35_1', '1_1'].includes(crop.ratio) || ratios.has(crop.ratio)) throw new WechatPublishingValidationError('封面裁剪比例无效');
    ratios.add(crop.ratio);
    const coordinates = ['x1', 'y1', 'x2', 'y2'].map((key) => Number(crop[key]));
    if (coordinates.some((value) => !Number.isFinite(value) || value < 0 || value > 1) || coordinates[0] >= coordinates[2] || coordinates[1] >= coordinates[3]) throw new WechatPublishingValidationError('封面裁剪区域无效');
    return { ratio: crop.ratio, ...Object.fromEntries(['x1', 'y1', 'x2', 'y2'].map((key, index) => [key, String(coordinates[index])])) };
  });
  return {
    author: boundedText(input.author, '作者', 16), digest: boundedText(input.digest, '摘要', 120),
    contentSourceUrl, openComment: input.openComment === true, fansOnlyComment: input.openComment === true && input.fansOnlyComment === true,
    coverFileId, themeId, ...(normalizedCrops.length ? { coverInfo: { crop_percent_list: normalizedCrops } } : {}),
  };
}

export function wechatCoverCrop(width, height, ratio, focusX = 50, focusY = 50) {
  if (![width, height, Number(focusX), Number(focusY)].every(Number.isFinite) || !(width > 0 && height > 0) || !['2.35_1', '1_1'].includes(ratio)) throw new WechatPublishingValidationError('封面尺寸、位置或比例无效');
  const aspect = ratio === '2.35_1' ? 2.35 : 1;
  const cropWidth = Math.min(1, height * aspect / width);
  const cropHeight = Math.min(1, width / aspect / height);
  const x1 = (1 - cropWidth) * Math.min(1, Math.max(0, Number(focusX) / 100));
  const y1 = (1 - cropHeight) * Math.min(1, Math.max(0, Number(focusY) / 100));
  return { ratio, x1: x1.toFixed(6), y1: y1.toFixed(6), x2: (x1 + cropWidth).toFixed(6), y2: (y1 + cropHeight).toFixed(6) };
}
