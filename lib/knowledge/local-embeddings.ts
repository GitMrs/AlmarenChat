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
    env: { remoteHost?: string };
    pipeline: (
      task: 'feature-extraction',
      model: string,
      options: { dtype: string }
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
  return transformers.pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5', { dtype });
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
  pipePromise ||= loadPipeline();
  const pipe = await pipePromise;
  const output = await pipe(input, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}
