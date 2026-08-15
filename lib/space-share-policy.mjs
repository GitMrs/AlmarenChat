import path from 'node:path';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export function isValidShareId(value) {
  return typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
}

export function resolveSharedResource(entryPath, pathParts = []) {
  const normalizedEntry = String(entryPath || '').replaceAll('\\', '/');
  if (!normalizedEntry || pathParts.some((part) => (
    typeof part !== 'string'
    || !part
    || part === '.'
    || part === '..'
    || part.includes('/')
    || part.includes('\\')
    || part.includes('\0')
  ))) return null;

  if (pathParts.length === 0) {
    const extension = path.posix.extname(normalizedEntry).toLowerCase();
    return ['.html', '.htm'].includes(extension)
      ? { relativePath: normalizedEntry, mimeType: MIME_TYPES[extension] }
      : null;
  }

  const relativePath = path.posix.join(path.posix.dirname(normalizedEntry), ...pathParts);
  const extension = path.posix.extname(relativePath).toLowerCase();
  if (!MIME_TYPES[extension] || ['.html', '.htm'].includes(extension)) return null;
  return { relativePath, mimeType: MIME_TYPES[extension] };
}
