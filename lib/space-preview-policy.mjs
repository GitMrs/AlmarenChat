import { STATIC_HTML_SANDBOX } from './static-html-sandbox.mjs';

export function spacePreviewPolicy({ origin, token, externalImages = false }) {
  const root = `${origin}/api/space-previews/${token}/`;
  return [
    `sandbox ${STATIC_HTML_SANDBOX}`,
    "default-src 'none'",
    `script-src 'unsafe-inline' ${root}`,
    `style-src 'unsafe-inline' ${root}`,
    `img-src ${root} data: blob:${externalImages ? ' https:' : ''}`,
    `font-src ${root} data:`,
    `media-src ${root}`,
    `connect-src ${root}`,
    "object-src 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    `form-action ${root}`,
    "base-uri 'none'",
  ].join('; ');
}
