const MAX_PROMPT_CHARS = 2_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_GENERATION_SIZES = Object.freeze(['1024x1024', '1536x1024', '1024x1536']);
const ALLOWED_SIZES = new Set(IMAGE_GENERATION_SIZES);

function imageGenerationUrl(baseURL) {
  const normalized = String(baseURL || '').trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('图片模型 Base URL 未配置');
  const withoutCompletion = normalized.replace(/\/chat\/completions$/i, '');
  return withoutCompletion.endsWith('/images/generations')
    ? withoutCompletion
    : `${withoutCompletion}/images/generations`;
}

function detectImage(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { extension: '.png', mimeType: 'image/png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { extension: '.jpg', mimeType: 'image/jpeg' };
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return { extension: '.webp', mimeType: 'image/webp' };
  }
  throw new Error('图片模型返回了不支持或无效的图片格式');
}

export async function requestGeneratedImage({
  model,
  prompt,
  size,
  signal,
  fetchImpl = fetch,
  timeoutMs = 120_000,
}) {
  const normalizedPrompt = String(prompt || '').trim();
  if (!normalizedPrompt) throw new Error('图片提示词不能为空');
  if (normalizedPrompt.length > MAX_PROMPT_CHARS) throw new Error(`图片提示词不能超过 ${MAX_PROMPT_CHARS} 个字符`);
  if (!model?.apiKey || !model?.baseURL || !model?.name) throw new Error('账号图片模型配置不完整');
  const requestedSize = size || model.size || '1024x1024';
  if (!ALLOWED_SIZES.has(requestedSize)) throw new Error('图片尺寸不受支持');
  if (signal?.aborted) throw new Error('图片生成已取消');

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  timer.unref?.();
  let response;
  try {
    response = await fetchImpl(imageGenerationUrl(model.baseURL), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${model.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: model.name, prompt: normalizedPrompt, n: 1, size: requestedSize, response_format: 'b64_json' }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(signal?.aborted ? '图片生成已取消' : '图片生成请求超时');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`图片生成请求失败（${response.status}）${body ? `：${body.slice(0, 500)}` : ''}`);
  }
  const payload = await response.json();
  const encoded = payload?.data?.[0]?.b64_json;
  if (!encoded) throw new Error('图片模型未返回 b64_json；为避免下载不受信任地址，不接受仅 URL 响应');
  if (encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 16) throw new Error('图片模型返回的数据超过 8MB 限制');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error('图片模型返回的数据为空或超过 8MB 限制');
  return { bytes, ...detectImage(bytes), imageSize: requestedSize, model: model.name, prompt: normalizedPrompt };
}
