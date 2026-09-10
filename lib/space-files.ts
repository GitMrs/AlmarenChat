export const MAX_EDITABLE_SPACE_FILE_BYTES = 1024 * 1024;

const EDITABLE_EXTENSIONS = new Set([
  '.css', '.csv', '.html', '.htm', '.js', '.json', '.jsx', '.md', '.markdown',
  '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);

export function isEditableSpaceFile(fileName: string) {
  const match = String(fileName || '').toLowerCase().match(/\.[^.]+$/);
  return Boolean(match && EDITABLE_EXTENSIONS.has(match[0]));
}

const PREVIEWABLE_IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp']);
const PREVIEWABLE_IMAGE_MIME_TYPES = new Set(['image/avif', 'image/gif', 'image/jpeg', 'image/png', 'image/webp']);

export function isPreviewableSpaceImage(fileName: string, mimeType?: string | null) {
  const normalizedMimeType = String(mimeType || '').split(';', 1)[0].trim().toLowerCase();
  if (PREVIEWABLE_IMAGE_MIME_TYPES.has(normalizedMimeType)) return true;
  const match = String(fileName || '').toLowerCase().match(/\.[^.]+$/);
  return Boolean(match && PREVIEWABLE_IMAGE_EXTENSIONS.has(match[0]));
}
