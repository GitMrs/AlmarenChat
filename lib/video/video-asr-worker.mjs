// ASR 子进程入口：独立进程加载 whisper 并转写，完成后强制退出。
// 为什么必须是独立进程：onnxruntime-node 的线程池在任务完成后仍自旋吃 CPU，
// 且模型占 ~1GB 内存；放进子进程，退出即彻底释放，宿主（dev server）不受影响。
//
// 用法：node lib/video/video-asr-worker.mjs <pcm文件路径>
// 输出：stdout 最后一行 JSON {"text":"..."}

import fs from 'node:fs/promises';

const pcmPath = process.argv[2];
if (!pcmPath) {
  console.error('缺少 PCM 文件路径参数');
  process.exit(2);
}

const raw = await fs.readFile(pcmPath);
const pcm = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 4));

const tf = await import('@huggingface/transformers');
if (typeof tf?.env?.remoteHost === 'string' && !process.env.HF_REMOTE_HOST) {
  tf.env.remoteHost = 'https://hf-mirror.com';
}

const transcriber = await tf.pipeline(
  'automatic-speech-recognition',
  process.env.ASR_MODEL || 'Xenova/whisper-small',
  { dtype: process.env.ASR_DTYPE || 'q8' }
);

const result = await transcriber(pcm, {
  chunk_length_s: 30,
  stride_length_s: 5,
  language: 'chinese',
  task: 'transcribe',
});

process.stdout.write(JSON.stringify({ text: String(result?.text || '') }));
process.exit(0); // 关键：强制退出，不给 ONNX 线程自旋的机会
