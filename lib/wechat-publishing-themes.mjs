function publishingTheme(config) {
  return Object.freeze(config);
}

export const WECHAT_PUBLISHING_THEMES = Object.freeze([
  publishingTheme({
    id: 'minimal',
    name: '简约黑白',
    accent: '#1f2937',
    accentSoft: '#f3f4f6',
    quoteBorder: '#9ca3af',
    quoteBackground: '#f7f7f7',
    cardBackground: '#fafafa',
    border: '#d1d5db',
    link: '#4b5563',
  }),
  publishingTheme({
    id: 'fresh-green',
    name: '清新绿',
    accent: '#16a34a',
    accentSoft: '#f0fdf4',
    quoteBorder: '#86efac',
    quoteBackground: '#f7fcf8',
    cardBackground: '#f8fcf9',
    border: '#d1e7d7',
    link: '#15803d',
  }),
  publishingTheme({
    id: 'business-blue',
    name: '商务蓝',
    accent: '#2563eb',
    accentSoft: '#eff6ff',
    quoteBorder: '#93c5fd',
    quoteBackground: '#f5f9ff',
    cardBackground: '#f8faff',
    border: '#cbdaf4',
    link: '#315eaf',
  }),
]);

const THEME_BY_ID = new Map(WECHAT_PUBLISHING_THEMES.map((item) => [item.id, item]));

export function getWechatPublishingTheme(themeId) {
  return THEME_BY_ID.get(String(themeId || '')) || THEME_BY_ID.get('fresh-green');
}
