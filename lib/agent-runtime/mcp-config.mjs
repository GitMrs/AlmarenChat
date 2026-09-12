const MAX_SERVERS = 4;

export function parseMcpServers(value) {
  if (!value) return [];
  let raw;
  try { raw = typeof value === 'string' ? JSON.parse(value) : value; } catch { return []; }
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SERVERS).flatMap((item) => {
    const id = String(item?.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
    let url;
    try { url = new URL(String(item?.url || '')); } catch { return []; }
    if (!id || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))) return [];
    const headers = item?.headers && typeof item.headers === 'object' && !Array.isArray(item.headers)
      ? Object.fromEntries(Object.entries(item.headers).filter(([key, header]) => /^[A-Za-z0-9-]{1,80}$/.test(key) && typeof header === 'string').slice(0, 16))
      : {};
    return [{ id, url: url.toString(), headers }];
  });
}
