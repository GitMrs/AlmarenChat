export function blockBeatsDetailUrl(kind, id) {
  const value = String(id ?? '').trim();
  if (!/^[1-9]\d*$/.test(value)) return '';
  if (kind !== 'flash' && kind !== 'art') return '';
  return `https://www.theblockbeats.info/${kind === 'flash' ? 'flash' : 'news'}/${value}`;
}

export function normalizeBlockBeatsItemLink(item) {
  if (item.source !== 'blockbeats') return item;
  const match = /^bb-(flash|art)-(\d+)$/.exec(item.id || '');
  if (!match) return item;
  const url = blockBeatsDetailUrl(match[1], match[2]);
  return url && url !== item.url ? { ...item, url } : item;
}
