import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { generateWorkspaceImage, generateWorkspaceImages } from './image-generation-runtime.mjs';
import { imageGenerationTimeoutMs } from '../../lib/image-generation.mjs';

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

test('chat image requests allow five minutes while image endpoints keep two minutes', () => {
  assert.equal(imageGenerationTimeoutMs('OPENAI_CHAT'), 300_000);
  assert.equal(imageGenerationTimeoutMs('OPENAI_IMAGES'), 120_000);
});

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

test('chat image protocol uses chat completions and accepts New API image data URLs', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'image-runtime-chat-'));
  const workspaceOptions = { projectRoot, userId: 'user-1', spaceId: 'space-1', taskId: 'task-1', attempt: 1 };
  let request;
  try {
    const result = await generateWorkspaceImage({
      model: { ...model, protocol: 'OPENAI_CHAT' },
      prompt: 'A landscape illustration',
      fileName: 'landscape',
      size: '1536x1024',
      workspaceOptions,
      fetchImpl: async (url, options) => {
        request = { url, options };
        return response({ choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${PNG.toString('base64')}` } }] } }] });
      },
    });
    const body = JSON.parse(request.options.body);
    assert.equal(request.url, 'https://example.com/v1/chat/completions');
    assert.deepEqual(body.modalities, ['text', 'image']);
    assert.equal(body.image_config.aspect_ratio, '3:2');
    assert.equal(body.stream, false);
    assert.equal(result.path, 'assets/landscape.png');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('chat image protocol accepts a data URL embedded in Markdown content', async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'image-runtime-markdown-'));
  const workspaceOptions = { projectRoot, userId: 'user-1', spaceId: 'space-1', taskId: 'task-1', attempt: 1 };
  try {
    const result = await generateWorkspaceImage({
      model: { ...model, protocol: 'OPENAI_CHAT' },
      prompt: 'A team illustration',
      fileName: 'team',
      workspaceOptions,
      fetchImpl: async () => response({
        choices: [{ message: { content: `Generated image:\n![team](data:image/png;base64,${PNG.toString('base64')})` } }],
      }),
    });
    assert.equal(result.path, 'assets/team.png');
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
  }), /未返回可解析的 Base64 图片/);
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

test('chat image parse errors include only a structural response summary', async () => {
  await assert.rejects(() => generateWorkspaceImage({
    model: { ...model, protocol: 'OPENAI_CHAT' },
    prompt: 'test',
    fileName: 'missing-image',
    workspaceOptions: {},
    fetchImpl: async () => response({
      choices: [{ message: { content: 'No image', images: [{ image_url: { url: 'https://signed.example/secret' } }] } }],
    }),
  }), (error) => {
    assert.match(error.message, /"imageUrlKind":"remote-url"/);
    assert.doesNotMatch(error.message, /signed\.example|No image/);
    return true;
  });
});

test('image generation rejects more than one image per request', async () => {
  await assert.rejects(() => generateWorkspaceImages({
    images: ['cover', 'body'].map((fileName) => ({
      fileName, prompt: `${fileName} prompt`, purpose: `${fileName}用途`,
    })),
  }), /每次只能生成 1 张图片/);
});

test('batch marks model compatibility failures as non-retryable', async () => {
  const result = await generateWorkspaceImages({
    images: [{ fileName: 'cover', prompt: 'cover', purpose: '封面' }],
    generateImage: async () => {
      throw new Error('not supported model for image generation, only imagen models are supported');
    },
  });
  assert.equal(result.failures[0].nonRetryable, true);
});

test('batch marks timeouts and exhausted quota as non-retryable', async () => {
  for (const message of [
    '图片生成请求超时',
    '图片生成请求失败（429）：You have exhausted your capacity on this model.',
  ]) {
    const result = await generateWorkspaceImages({
      images: [{ fileName: 'cover', prompt: 'cover', purpose: '封面' }],
      generateImage: async () => { throw new Error(message); },
    });
    assert.equal(result.failures[0].nonRetryable, true);
  }
});
