export const MAX_EDITABLE_SPACE_FILE_BYTES = 1024 * 1024;

const EDITABLE_EXTENSIONS = new Set([
  '.css', '.csv', '.html', '.htm', '.js', '.json', '.jsx', '.md', '.markdown',
  '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);

export function isEditableSpaceFile(fileName: string) {
  const match = String(fileName || '').toLowerCase().match(/\.[^.]+$/);
  return Boolean(match && EDITABLE_EXTENSIONS.has(match[0]));
}
