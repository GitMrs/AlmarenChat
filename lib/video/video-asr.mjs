// B站视频 ASR：无字幕视频下载音频轨 → ffmpeg 解码 16kHz 单声道 PCM → 本地 whisper-small 转写。
// 设计约束：
// - 默认不自动触发；只有用户明确确认后，由 bilibili_video 工具以 transcribe=true + confirmed=true 调用（CPU 转写是分钟级）。
// - 模块级互斥锁：同时只跑一条转写，避免 CPU 被打满。
// - 转写结果按 bvid 落盘缓存（data/video-asr/<bvid>.json），同一视频终身只转一次。
// - 可用 VIDEO_ASR_ENABLED=0 全局关闭；VIDEO_ASR_MAX_DURATION_S 控制最长视频（默认 1200s）。

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { smartFetch } from '../web/proxy.ts';
import { buildBilibiliHeaders } from './web-video.mjs';

const CACHE_DIR = path.join(process.cwd(), 'data', 'video-asr');
const MAX_AUDIO_BYTES = 80 * 1024 * 1024; // 音频下载上限（约 80MB，防失控）

export function isVideoAsrEnabled() {
  return String(process.env.VIDEO_ASR_ENABLED || '1').trim() !== '0';
}

function getMaxDurationS() {
  return Number(process.env.VIDEO_ASR_MAX_DURATION_S || 1200);
}

export function getAsrCachePath(bvid) {
  return path.join(CACHE_DIR, `${bvid}.json`);
}

export async function readAsrCache(bvid) {
  try {
    const raw = await fs.readFile(getAsrCachePath(bvid), 'utf8');
    const data = JSON.parse(raw);
    return typeof data?.text === 'string' ? data : null;
  } catch {
    return null;
  }
}

/** 取 B站 dash 音频流地址（选最低码率，ASR 不需要高音质，省流量）。 */
export async function getBilibiliAudioUrl(bvid, cid, { fetchImpl = smartFetch, cookie } = {}) {
  const api = `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&fnval=16&fnver=0`;
  const response = await fetchImpl(api, { headers: buildBilibiliHeaders(cookie) });
  if (!response.ok) return null;
  const json = await response.json();
  const audios = json?.data?.dash?.audio;
  if (!Array.isArray(audios) || audios.length === 0) return null;
  const best = [...audios].sort((a, b) => (a.bandwidth || 0) - (b.bandwidth || 0))[0];
  return best?.baseUrl || best?.base_url || null;
}

/** ffmpeg 解码为 16kHz 单声道 float32 PCM，直接产出 whisper 输入。 */
export function decodeToPcm(inputPath, outputPath, { ffmpegBin = 'ffmpeg' } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBin, [
      '-y', '-i', inputPath,
      '-f', 'f32le', '-acodec', 'pcm_f32le', '-ar', '16000', '-ac', '1',
      outputPath,
    ], { stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg 退出码 ${code}`))));
  });
}

let asrMutex = Promise.resolve();
const WORKER_TIMEOUT_MS = Number(process.env.ASR_WORKER_TIMEOUT_MS || 30 * 60 * 1000);

/** 在独立子进程中跑 whisper：转写完进程退出，ONNX 线程和 ~1GB 内存随之彻底释放。 */
function runAsrWorker(pcmPath) {
  const workerPath = path.join(process.cwd(), 'lib', 'video', 'video-asr-worker.mjs');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [workerPath, pcmPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('ASR worker 超时'));
    }, WORKER_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`ASR worker 退出码 ${code}: ${err.slice(-300)}`));
      try {
        const lastLine = out.trim().split('\n').pop();
        resolve(String(JSON.parse(lastLine)?.text || '').trim());
      } catch {
        reject(new Error('ASR worker 输出解析失败'));
      }
    });
  });
}

/** whisper 在静音/音乐/低语音段会产生无限重复幻听，连续重复同一片段即视为幻听。 */
export function looksLikeHallucination(text) {
  return /(.{5,30})\1{4,}/.test(String(text || ''));
}

async function downloadAudio(url, destPath, { fetchImpl = smartFetch, cookie } = {}) {
  const response = await fetchImpl(url, { headers: buildBilibiliHeaders(cookie) });
  if (!response.ok) throw new Error(`音频下载失败: HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_AUDIO_BYTES) throw new Error(`音频过大: ${buffer.length} 字节`);
  await fs.writeFile(destPath, buffer);
  return buffer.length;
}

/** yt-dlp 下载 YouTube 音频到 tmpDir，返回实际文件路径。需要宿主环境带 HTTPS_PROXY 或全局代理。 */
export async function downloadYouTubeAudio(videoId, tmpDir, { ytdlpBin = process.env.YTDLP_BIN || 'yt-dlp' } = {}) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const outTemplate = path.join(tmpDir, 'audio.%(ext)s');

  const args = [
    '-f', 'bestaudio/best',
    '--no-playlist',
    '--no-warnings',
    '--js-runtimes', 'node',
    '-o', outTemplate,
  ];

  // 若配置了 YOUTUBE_COOKIE，自动生成 Netscape 格式的临时 Cookie 文件传给 yt-dlp 绕过机器人验证
  const rawCookie = process.env.YOUTUBE_COOKIE || process.env.YT_COOKIE;
  let cookieFilePath = null;
  if (rawCookie) {
    cookieFilePath = path.join(tmpDir, 'yt_cookie.txt');
    const lines = ['# Netscape HTTP Cookie File'];
    for (const part of rawCookie.split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k && v.length) {
        lines.push(['.youtube.com', 'TRUE', '/', 'TRUE', '2147483647', k, v.join('=')].join('\t'));
      }
    }
    await fs.writeFile(cookieFilePath, lines.join('\n'), 'utf-8');
    args.push('--cookies', cookieFilePath);
  }

  args.push(url);

  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlpBin, args, { stdio: 'ignore' });
    proc.on('error', reject);
    proc.on('close', async (code) => {
      if (cookieFilePath) {
        await fs.unlink(cookieFilePath).catch(() => {});
      }
      if (code !== 0) return reject(new Error(`yt-dlp 退出码 ${code}`));
      try {
        const files = await fs.readdir(tmpDir);
        const audio = files.find((f) => f.startsWith('audio.'));
        resolve(audio ? path.join(tmpDir, audio) : null);
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * 转写 B站视频音频。返回 { text, cached } 或 null（不可用/超时长/失败）。
 * 失败不抛异常——ASR 是研习的增强手段，绝不能拖垮主流程。
 * @returns {Promise<{ text: string, cached: boolean } | null>}
 */
export function transcribeBilibiliVideo(
  { bvid, cid, duration },
  { fetchImpl = smartFetch, transcribeImpl = undefined, cookie } = {}
) {
  return enqueueAsr(() =>
    transcribeInternal({ cacheKey: bvid, duration }, { transcribeImpl }, async (tmpDir) => {
      const audioUrl = await getBilibiliAudioUrl(bvid, cid, { fetchImpl, cookie });
      if (!audioUrl) return null;
      const m4sPath = path.join(tmpDir, 'audio.m4s');
      await downloadAudio(audioUrl, m4sPath, { fetchImpl, cookie });
      return m4sPath;
    })
  );
}

/**
 * 转写 YouTube 视频音频（yt-dlp 拉音频，需要宿主带代理）。
 * @returns {Promise<{ text: string, cached: boolean } | null>}
 */
export function transcribeYouTubeVideo(
  { videoId, duration },
  { transcribeImpl = undefined, ytdlpBin = undefined } = {}
) {
  return enqueueAsr(() =>
    transcribeInternal({ cacheKey: `yt-${videoId}`, duration }, { transcribeImpl }, async (tmpDir) => {
      return await downloadYouTubeAudio(videoId, tmpDir, { ytdlpBin });
    })
  );
}

function enqueueAsr(fn) {
  // 模块级互斥：串行执行，CPU 只跑一条转写
  const task = asrMutex.then(fn);
  asrMutex = task.catch(() => {});
  return task;
}

async function transcribeInternal({ cacheKey, duration }, { transcribeImpl }, acquireAudio) {
  if (!isVideoAsrEnabled()) return null;
  if (!cacheKey) return null;
  if (duration && duration > getMaxDurationS()) return null;

  const cached = await readAsrCache(cacheKey);
  if (cached) return { text: cached.text, cached: true };

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'video-asr-'));
  try {
    const audioPath = await acquireAudio(tmpDir);
    if (!audioPath) return null;

    const pcmPath = path.join(tmpDir, 'audio.pcm');
    await decodeToPcm(audioPath, pcmPath);

    const raw = await fs.readFile(pcmPath);
    const sampleCount = Math.floor(raw.length / 4);
    if (sampleCount < 16000) return null; // 不足 1 秒音频，视为无效

    let text;
    if (transcribeImpl) {
      // 测试注入：直接在当前进程内转写
      const pcm = new Float32Array(raw.buffer, raw.byteOffset, sampleCount);
      const result = await transcribeImpl(pcm);
      text = String(result?.text || result || '').trim();
    } else {
      text = await runAsrWorker(pcmPath);
    }
    if (!text) return null;
    if (looksLikeHallucination(text)) {
      // 幻听结果不采用；写入空缓存，避免同一视频每天反复白跑几分钟 CPU
      await fs.mkdir(CACHE_DIR, { recursive: true });
      await fs.writeFile(
        getAsrCachePath(cacheKey),
        JSON.stringify({ id: cacheKey, text: '', hallucination: true, at: new Date().toISOString() })
      );
      return null;
    }

    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(
      getAsrCachePath(cacheKey),
      JSON.stringify({ id: cacheKey, text, at: new Date().toISOString() }, null, 2)
    );
    return { text, cached: false };
  } catch (error) {
    console.warn('[video-asr] 转写失败:', error?.message || error);
    return null;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
