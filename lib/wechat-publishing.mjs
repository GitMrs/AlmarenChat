const PRELUDE_HEADING_PATTERN = /(?:备选标题|文章摘要|发布信息|发布资料|创作说明)/;
const SUPPORTING_FILE_PATTERN = /(?:^|[-_. ])(?:publish[-_ ]?info|readme|sources?|references?|outline|draft|notes?)(?:[-_. ]|$)|(?:发布信息|发布资料|发布说明|来源清单|参考资料|文章大纲|创作大纲|素材清单|工作笔记|文章草稿)/i;

export function isWechatPublishableMarkdownFile(fileName) {
  const normalized = String(fileName || '').trim();
  if (!/\.(?:md|markdown)$/i.test(normalized)) return false;
  return !SUPPORTING_FILE_PATTERN.test(normalized);
}

export function extractWechatArticleMarkdown(value) {
  const source = String(value || '').trim();
  if (!source) return '';

  const lines = source.split(/\r?\n/);
  const headings = lines
    .map((line, index) => ({ index, title: line.match(/^#\s+(.+?)\s*$/)?.[1] || '' }))
    .filter((item) => item.title);

  if (headings.length >= 2 && PRELUDE_HEADING_PATTERN.test(headings[0].title)) {
    return lines.slice(headings[1].index).join('\n').trim();
  }

  return source;
}

export function splitWechatArticleMarkdown(value) {
  const markdown = extractWechatArticleMarkdown(value);
  if (!markdown) return { title: '', body: '' };

  const lines = markdown.split(/\r?\n/);
  const titleMatch = lines[0].match(/^#\s+(.+?)\s*$/);
  if (!titleMatch) return { title: '', body: markdown };

  return {
    title: titleMatch[1].trim(),
    body: lines.slice(1).join('\n').trim(),
  };
}
