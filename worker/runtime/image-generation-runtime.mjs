import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { workspaceAttemptFile } from '../../lib/workspace-staging.mjs';
import { IMAGE_GENERATION_SIZES, requestGeneratedImage } from '../../lib/image-generation.mjs';

const MAX_PROMPT_CHARS = 2_000;
const ALLOWED_SIZES = new Set(IMAGE_GENERATION_SIZES);
const SAFE_FILE_STEM = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

export const generateImageToolSchema = {
  type: 'function',
  function: {
    name: 'generate_image',
    description: '使用账号已配置的图片模型生成一张图片，并保存到当前空间的 assets 目录。返回值只包含文件信息，不包含 Base64。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['prompt', 'fileName'],
      properties: {
        prompt: { type: 'string', maxLength: MAX_PROMPT_CHARS, description: '具体、完整的图片生成提示词。' },
        fileName: { type: 'string', pattern: SAFE_FILE_STEM.source, description: '不含目录和扩展名的安全英文文件名。' },
        size: { type: 'string', enum: [...ALLOWED_SIZES], description: '可选图片尺寸；不填时使用账号默认尺寸。' },
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
  timeoutMs = 120_000,
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
