import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateWorkspaceImage } from './image-generation-runtime.mjs';

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const model = { apiKey: 'secret', baseURL: 'https://example.com/v1', name: 'image-model', size: '1024x1024' };

function response(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

test('generated images are written under assets without returning base64', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'image-runtime-'));
  const workspaceOptions = { projectRoot, userId: 'user-1', spaceId: 'space-1', taskId: 'task-1', attempt: 1 };
  let request;
  try {
    const result = await generateWorkspaceImage({
      model,
      prompt: 'A clean product illustration',
      fileName: 'hero-image',
      workspaceOptions,
      fetchImpl: async (url, options) => {
        request = { url, options };
        return response({ data: [{ b64_json: PNG.toString('base64') }] });
      },
    });
    assert.equal(request.url, 'https://example.com/v1/images/generations');
    assert.equal(JSON.parse(request.options.body).response_format, 'b64_json');
    assert.equal(result.path, 'assets/hero-image.png');
    assert.equal('b64_json' in result, false);
    assert.deepEqual(
      await readFile(path.join(projectRoot, 'data/spaces/user-1/space-1/staging/task-1/1/workspace/assets/hero-image.png')),
      PNG
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('image generation rejects unsafe names and URL-only responses', async () => {
  await assert.rejects(() => generateWorkspaceImage({
    model, prompt: 'test', fileName: '../outside', workspaceOptions: {}, fetchImpl: async () => response({}),
  }), /文件名/);
  await assert.rejects(() => generateWorkspaceImage({
    model,
    prompt: 'test',
    fileName: 'safe-name',
    workspaceOptions: {},
    fetchImpl: async () => response({ data: [{ url: 'https://untrusted.example/image.png' }] }),
  }), /不接受仅 URL 响应/);
});

test('image generation rejects invalid binary data', async () => {
  await assert.rejects(() => generateWorkspaceImage({
    model,
    prompt: 'test',
    fileName: 'bad-image',
    workspaceOptions: {},
    fetchImpl: async () => response({ data: [{ b64_json: Buffer.from('not an image').toString('base64') }] }),
  }), /无效的图片格式/);
});
