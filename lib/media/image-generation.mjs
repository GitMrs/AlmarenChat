const MAX_PROMPT_CHARS = 2_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_GENERATION_SIZES = Object.freeze(['1024x1024', '1536x1024', '1024x1536']);
export const IMAGE_MODEL_PROTOCOLS = Object.freeze(['OPENAI_IMAGES', 'OPENAI_CHAT']);
const ALLOWED_SIZES = new Set(IMAGE_GENERATION_SIZES);
const ALLOWED_PROTOCOLS = new Set(IMAGE_MODEL_PROTOCOLS);

export function imageGenerationTimeoutMs(protocol) {
  return protocol === 'OPENAI_CHAT' ? 5 * 60_000 : 2 * 60_000;
}

function imageGenerationUrl(baseURL) {
  const normalized = String(baseURL || '').trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('图片模型 Base URL 未配置');
  const withoutCompletion = normalized.replace(/\/chat\/completions$/i, '');
  return withoutCompletion.endsWith('/images/generations')
    ? withoutCompletion
    : `${withoutCompletion}/images/generations`;
}

function chatCompletionUrl(baseURL) {
  const normalized = String(baseURL || '').trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('图片模型 Base URL 未配置');
  const withoutImages = normalized.replace(/\/images\/generations$/i, '');
  return withoutImages.endsWith('/chat/completions')
    ? withoutImages
    : `${withoutImages}/chat/completions`;
}

function imageAspectRatio(size) {
  if (size === '1536x1024') return '3:2';
  if (size === '1024x1536') return '2:3';
  return '1:1';
}

function base64FromDataUrl(value) {
  if (typeof value !== 'string') return '';
  const match = value.match(/data:image\/[a-zA-Z0-9.+-]+;base64,([a-zA-Z0-9+/=\r\n]+)/);
  return match?.[1]?.replace(/\s+/g, '') || '';
}

function imageResponseShape(payload) {
  const choice = payload?.choices?.[0];
  const message = choice?.message;
  const content = message?.content;
  const images = message?.images;
  const urlValue = Array.isArray(images) ? images[0]?.image_url?.url || images[0]?.url : '';
  return {
    topLevelKeys: payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 12) : [],
    choiceKeys: choice && typeof choice === 'object' ? Object.keys(choice).slice(0, 12) : [],
    messageKeys: message && typeof message === 'object' ? Object.keys(message).slice(0, 12) : [],
    contentType: Array.isArray(content) ? 'array' : typeof content,
    contentLength: typeof content === 'string' ? content.length : Array.isArray(content) ? content.length : 0,
    contentPartTypes: Array.isArray(content) ? content.map((part) => String(part?.type || '')).slice(0, 8) : [],
    imageCount: Array.isArray(images) ? images.length : 0,
    imageUrlKind: typeof urlValue === 'string' && urlValue.startsWith('data:image/')
      ? 'data-url'
      : typeof urlValue === 'string' && /^https?:\/\//i.test(urlValue)
        ? 'remote-url'
        : 'missing',
    dataCount: Array.isArray(payload?.data) ? payload.data.length : 0,
    dataItemKeys: payload?.data?.[0] && typeof payload.data[0] === 'object'
      ? Object.keys(payload.data[0]).slice(0, 12)
      : [],
  };
}

function chatResponseBase64(payload) {
  const message = payload?.choices?.[0]?.message;
  const images = Array.isArray(message?.images) ? message.images : [];
  for (const image of images) {
    const encoded = base64FromDataUrl(image?.image_url?.url || image?.url);
    if (encoded) return encoded;
  }
  const content = Array.isArray(message?.content) ? message.content : [];
  for (const part of content) {
    const encoded = part?.b64_json
      || part?.inline_data?.data
      || part?.inlineData?.data
      || base64FromDataUrl(part?.image_url?.url || part?.url);
    if (encoded) return String(encoded).replace(/\s+/g, '');
  }
  return base64FromDataUrl(typeof message?.content === 'string' ? message.content : '');
}

export function isNonRetryableImageGenerationError(value) {
  const message = String(value?.message || value || '').toLocaleLowerCase();
  return [
    'not supported model',
    'only imagen models are supported',
    'invalid api key',
    'incorrect api key',
    'unauthorized',
    'authentication',
    '请求失败（401）',
    '请求失败（403）',
    '请求失败（404）',
    '请求失败（429）',
    '请求超时',
    'quota',
    'capacity on this model',
    '图片模型配置不完整',
    '图片模型 base url 未配置',
    '图片模型接口协议不受支持',
    '图片模型未返回 base64 图片',
    '图片模型未返回可解析的 base64 图片',
    '不接受仅 url 响应',
  ].some((marker) => message.includes(marker));
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
  timeoutMs = undefined,
}) {
  const normalizedPrompt = String(prompt || '').trim();
  if (!normalizedPrompt) throw new Error('图片提示词不能为空');
  if (normalizedPrompt.length > MAX_PROMPT_CHARS) throw new Error(`图片提示词不能超过 ${MAX_PROMPT_CHARS} 个字符`);
  if (!model?.apiKey || !model?.baseURL || !model?.name) throw new Error('账号图片模型配置不完整');
  const protocol = model.protocol || 'OPENAI_IMAGES';
  if (!ALLOWED_PROTOCOLS.has(protocol)) throw new Error('图片模型接口协议不受支持');
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : imageGenerationTimeoutMs(protocol);
  const requestedSize = size || model.size || '1024x1024';
  if (!ALLOWED_SIZES.has(requestedSize)) throw new Error('图片尺寸不受支持');
  if (signal?.aborted) throw new Error('图片生成已取消');

  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, effectiveTimeoutMs);
  timer.unref?.();
  let response;
  try {
    response = await fetchImpl(
      protocol === 'OPENAI_CHAT' ? chatCompletionUrl(model.baseURL) : imageGenerationUrl(model.baseURL),
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${model.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(protocol === 'OPENAI_CHAT'
          ? {
              model: model.name,
              messages: [{ role: 'user', content: normalizedPrompt }],
              modalities: ['text', 'image'],
              image_config: { aspect_ratio: imageAspectRatio(requestedSize) },
              stream: false,
            }
          : { model: model.name, prompt: normalizedPrompt, n: 1, size: requestedSize, response_format: 'b64_json' }),
        signal: controller.signal,
      }
    );
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
  const encoded = protocol === 'OPENAI_CHAT'
    ? chatResponseBase64(payload)
    : payload?.data?.[0]?.b64_json;
  if (!encoded) {
    throw new Error(`图片模型未返回可解析的 Base64 图片；返回结构：${JSON.stringify(imageResponseShape(payload))}`);
  }
  if (encoded.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 16) throw new Error('图片模型返回的数据超过 8MB 限制');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) throw new Error('图片模型返回的数据为空或超过 8MB 限制');
  return { bytes, ...detectImage(bytes), imageSize: requestedSize, model: model.name, prompt: normalizedPrompt };
}
