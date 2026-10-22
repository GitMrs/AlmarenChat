import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generatedImageFileNames, removeGeneratedChatImages } from './generated-chat-images.mjs';

test('generated chat image cleanup ignores uploads and unsafe paths', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'generated-chat-image-'));
  const fileName = '123e4567-e89b-12d3-a456-426614174000.png';
  const directory = path.join(projectRoot, 'public', 'uploads', 'generated');
  const target = path.join(directory, fileName);
  const attachments = [
    { type: 'image', origin: 'generated', url: `/uploads/generated/${fileName}` },
    { type: 'image', origin: 'uploaded', url: '/uploads/images/user.png' },
    { type: 'image', origin: 'generated', url: '/uploads/generated/../../outside.png' },
  ];
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(target, 'image');
    assert.deepEqual(generatedImageFileNames(attachments), [fileName]);
    await removeGeneratedChatImages(attachments, projectRoot);
    await assert.rejects(readFile(target), /ENOENT/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
