import { rm } from 'node:fs/promises';
import path from 'node:path';

const GENERATED_IMAGE_URL = /^\/uploads\/generated\/([0-9a-f-]{36}\.(?:png|jpg|webp))$/i;

export function generatedImageFileNames(attachments) {
  if (!Array.isArray(attachments)) return [];
  return attachments.flatMap((attachment) => {
    if (attachment?.type !== 'image' || attachment?.origin !== 'generated') return [];
    const match = GENERATED_IMAGE_URL.exec(String(attachment.url || ''));
    return match ? [match[1]] : [];
  });
}

export async function removeGeneratedChatImages(attachments, projectRoot = process.cwd()) {
  await Promise.all(generatedImageFileNames(attachments).map((fileName) => (
    rm(path.join(projectRoot, 'public', 'uploads', 'generated', fileName), { force: true })
  )));
}
