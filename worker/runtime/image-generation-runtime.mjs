import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workspaceAttemptFile } from '../../lib/workspace-staging.mjs';
import { IMAGE_GENERATION_SIZES, isNonRetryableImageGenerationError, requestGeneratedImage } from '../../lib/image-generation.mjs';

const MAX_PROMPT_CHARS = 2_000;
const MAX_BATCH_IMAGES = 1;
const ALLOWED_SIZES = new Set(IMAGE_GENERATION_SIZES);
const SAFE_FILE_STEM = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

// Kept for persisted 1.0.0 Skill snapshots. New tasks only receive generate_images.
export const generateImageToolSchema = {
  type: 'function',
  function: {
    name: 'generate_image',
    description: '使用账号已配置的图片模型生成一张图片，并保存到当前空间的 assets 目录。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt', 'fileName'],
      properties: {
        prompt: { type: 'string', maxLength: MAX_PROMPT_CHARS },
        fileName: { type: 'string', pattern: SAFE_FILE_STEM.source },
        size: { type: 'string', enum: [...ALLOWED_SIZES] },
      },
    },
  },
};

export const generateImagesToolSchema = {
  type: 'function',
  function: {
    name: 'generate_images',
    description: '使用账号已配置的图片模型生成一张图片并保存到当前空间的 assets 目录。每次只能提交一张，返回值不包含 Base64。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['images'],
      properties: {
        images: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_BATCH_IMAGES,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['prompt', 'fileName', 'purpose'],
            properties: {
              prompt: { type: 'string', maxLength: MAX_PROMPT_CHARS, description: '基于来源内容形成的具体、完整图片提示词。' },
              fileName: { type: 'string', pattern: SAFE_FILE_STEM.source, description: '不含目录和扩展名的安全英文文件名。' },
              purpose: { type: 'string', maxLength: 200, description: '图片在交付物中的具体用途或对应位置。' },
              size: { type: 'string', enum: [...ALLOWED_SIZES], description: '可选图片尺寸；不填时使用账号默认尺寸。' },
            },
          },
        },
      },
    },
  },
};

export async function generateWorkspaceImage({
  model,
  prompt,
  fileName,
  size,
  workspaceOptions,
  isCancelled,
  fetchImpl = fetch,
  timeoutMs = undefined,
}) {
  const normalizedPrompt = String(prompt || '').trim();
  const normalizedFileName = String(fileName || '').trim();
  if (!normalizedPrompt) throw new Error('图片提示词不能为空');
  if (normalizedPrompt.length > MAX_PROMPT_CHARS) throw new Error(`图片提示词不能超过 ${MAX_PROMPT_CHARS} 个字符`);
  if (!SAFE_FILE_STEM.test(normalizedFileName)) throw new Error('图片文件名只能使用英文、数字、短横线和下划线，且不能包含路径');
  const requestedSize = size || model.size || '1024x1024';
  if (!ALLOWED_SIZES.has(requestedSize)) throw new Error('图片尺寸不受支持');
  if (isCancelled?.()) throw new Error('任务已取消');

  const controller = new AbortController();
  const cancellationTimer = setInterval(() => {
    if (isCancelled?.()) controller.abort();
  }, 250);
  cancellationTimer.unref?.();
  try {
    const generated = await requestGeneratedImage({
      model, prompt: normalizedPrompt, size: requestedSize, signal: controller.signal, fetchImpl, timeoutMs,
    });
    const relativePath = `assets/${normalizedFileName}${generated.extension}`;
    const { target } = workspaceAttemptFile(workspaceOptions, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    if (isCancelled?.()) throw new Error('任务已取消');
    await writeFile(target, generated.bytes);
    return {
      ok: true, path: relativePath, mimeType: generated.mimeType, size: generated.bytes.length,
      imageSize: generated.imageSize, model: generated.model,
    };
  } finally {
    clearInterval(cancellationTimer);
  }
}

export async function generateWorkspaceImages({ images, generateImage = generateWorkspaceImage, ...options }) {
  if (!Array.isArray(images) || images.length === 0 || images.length > MAX_BATCH_IMAGES) {
    throw new Error('每次只能生成 1 张图片');
  }
  const normalized = images.map((image) => ({
    prompt: String(image?.prompt || '').trim(),
    fileName: String(image?.fileName || '').trim(),
    purpose: String(image?.purpose || '').trim().slice(0, 200),
    size: image?.size,
  }));
  const fileNames = new Set();
  for (const image of normalized) {
    if (!image.prompt) throw new Error('图片提示词不能为空');
    if (image.prompt.length > MAX_PROMPT_CHARS) throw new Error(`图片提示词不能超过 ${MAX_PROMPT_CHARS} 个字符`);
    if (!SAFE_FILE_STEM.test(image.fileName)) throw new Error('图片文件名只能使用英文、数字、短横线和下划线，且不能包含路径');
    if (image.size && !ALLOWED_SIZES.has(image.size)) throw new Error('图片尺寸不受支持');
    if (!image.purpose) throw new Error('每张图片都必须说明具体用途');
    if (fileNames.has(image.fileName)) throw new Error(`图片文件名重复：${image.fileName}`);
    fileNames.add(image.fileName);
  }

  const results = new Array(normalized.length);
  let nextIndex = 0;
  const runNext = async () => {
    while (nextIndex < normalized.length) {
      const index = nextIndex;
      nextIndex += 1;
      const image = normalized[index];
      try {
        const result = await generateImage({ ...options, ...image });
        results[index] = { ...result, purpose: image.purpose };
      } catch (error) {
        results[index] = {
          ok: false,
          fileName: image.fileName,
          purpose: image.purpose,
          error: String(error?.message || error).slice(0, 500),
          nonRetryable: isNonRetryableImageGenerationError(error),
        };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, normalized.length) }, runNext));
  const completed = results.filter((result) => result?.ok);
  const failed = results.filter((result) => !result?.ok);
  return { ok: failed.length === 0, images: completed, failures: failed };
}
