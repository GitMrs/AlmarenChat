type FeatureExtractionPipeline = (
  text: string,
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array | number[] }>;

let pipePromise: Promise<FeatureExtractionPipeline> | null = null;

async function loadPipeline() {
  const dynamicImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string
  ) => Promise<{
    env: { remoteHost?: string };
    pipeline: (
      task: 'feature-extraction',
      model: string,
      options: { dtype: 'fp32' }
    ) => Promise<FeatureExtractionPipeline>;
  }>;

  let transformers;
  try {
    transformers = await dynamicImport('@huggingface/transformers');
  } catch {
    throw new Error('本地知识库需要安装 @huggingface/transformers。请先运行 yarn add @huggingface/transformers。');
  }

  transformers.env.remoteHost = process.env.HF_REMOTE_HOST || 'https://hf-mirror.com';
  return transformers.pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5', { dtype: 'fp32' });
}

export async function embedText(text: string) {
  pipePromise ||= loadPipeline();
  const pipe = await pipePromise;
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}
