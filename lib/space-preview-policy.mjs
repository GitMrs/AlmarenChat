import { STATIC_HTML_SANDBOX } from './static-html-sandbox.mjs';

export const TRUSTED_STATIC_CDN_SOURCES = Object.freeze([
  'https://cdn.jsdelivr.net',
  'https://cdnjs.cloudflare.com',
  'https://unpkg.com',
  'https://esm.sh',
]);

export function spacePreviewPolicy({ origin, token, externalImages = false, externalDependencies = false }) {
  const root = `${origin}/api/space-previews/${token}/`;
  const cdnSources = externalDependencies ? ` ${TRUSTED_STATIC_CDN_SOURCES.join(' ')}` : '';
  return [
    `sandbox ${STATIC_HTML_SANDBOX}`,
    "default-src 'none'",
    `script-src 'unsafe-inline' ${root}${cdnSources}`,
    `style-src 'unsafe-inline' ${root}${cdnSources}`,
    `img-src ${root} data: blob:${externalImages ? ' https:' : ''}`,
    `font-src ${root} data:${cdnSources}`,
    `media-src ${root}`,
    `connect-src ${root}`,
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    `form-action ${root}`,
    "base-uri 'none'",
  ].join('; ');
}
