import { existsSync } from 'node:fs';
import path from 'node:path';

type FeatureExtractionPipeline = (
  text: string,
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array | number[] }>;

// bge-small-zh-v1.5 上限 512 token，中文约 1 字 = 1 token。
// 超长会被模型静默截断，这里先按保守字符数截断并告警一次，避免尾部内容悄悄丢失。
const MAX_EMBED_CHARS = 480;
let truncationWarned = false;

let pipePromise: Promise<FeatureExtractionPipeline> | null = null;

async function loadPipeline() {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string
  ) => Promise<{
    env: { remoteHost?: string; cacheDir?: string | null };
    pipeline: (
      task: 'feature-extraction',
      model: string,
      options: { dtype: string; local_files_only?: boolean }
    ) => Promise<FeatureExtractionPipeline>;
  }>;

  let transformers;
  try {
    transformers = await dynamicImport('@huggingface/transformers');
  } catch {
    throw new Error('本地知识库需要安装 @huggingface/transformers。请先运行 yarn add @huggingface/transformers。');
  }

  transformers.env.remoteHost = process.env.HF_REMOTE_HOST || 'https://hf-mirror.com';
  // dtype：fp32 精度最好；q8 体积小一半、速度更快、精度损失极小。
  // 切换 dtype 需要下载对应的权重文件，可通过 EMBED_DTYPE=q8 开启。
  const dtype = process.env.EMBED_DTYPE || 'fp32';
  const modelId = 'Xenova/bge-small-zh-v1.5';
  if (transformers.env.cacheDir) {
    const cachedModelPath = path.join(transformers.env.cacheDir, modelId);
    if (['config.json', 'tokenizer.json', 'tokenizer_config.json'].every((file) => existsSync(path.join(cachedModelPath, file)))) {
      try {
        // 直接读取本地目录，避免等待模型仓库此前未完成的文件探测请求。
        return await transformers.pipeline('feature-extraction', cachedModelPath, { dtype, local_files_only: true });
      } catch {
        // 缓存可能缺少当前精度的权重，继续按仓库名补齐。
      }
    }
  }
  return transformers.pipeline('feature-extraction', modelId, { dtype });
}

export async function embedText(text: string) {
  let input = text;
  if (input.length > MAX_EMBED_CHARS) {
    input = input.slice(0, MAX_EMBED_CHARS);
    if (!truncationWarned) {
      truncationWarned = true;
      console.warn(`[Embeddings] 输入超过 ${MAX_EMBED_CHARS} 字符，已截断以适配 512 token 上限（后续不再重复提示）。`);
    }
  }
  pipePromise ||= loadPipeline().catch((error) => {
    pipePromise = null;
    throw error;
  });
  const pipe = await pipePromise;
  const output = await pipe(input, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}
