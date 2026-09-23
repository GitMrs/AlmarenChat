export const SHARE_THEMES = Object.freeze([
  { id: 'clean', name: '简洁阅读' },
  { id: 'editorial-handwritten', name: '编辑部手账' },
]);

const IDS = new Set(SHARE_THEMES.map((theme) => theme.id));

export function normalizeShareTheme(value) {
  const theme = String(value || '').trim().toLowerCase();
  return IDS.has(theme) ? theme : 'clean';
}
