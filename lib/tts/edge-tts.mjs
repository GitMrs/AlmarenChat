import crypto from 'node:crypto';
import { setGlobalDispatcher } from 'undici';
import { DEFAULT_VOICE_ID, resolveSafeVoice } from './voices.mjs';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const WIN_EPOCH = 11644473600;
const S_TO_NS = 1e9;
const DEFAULT_TIMEOUT_MS = 60000;
const INACTIVITY_TIMEOUT_MS = 30000;

import {
  checkPortOpen,
  getDirectAgent,
  getProxyAgent,
  getDetectedProxyInfo,
  ensureGlobalProxyDispatcher,
} from '../network/proxy.ts';

// 兼容导出，保持对外接口稳定
export { checkPortOpen, getDirectAgent };

export async function getDetectedProxyUrl(forceRefresh = false) {
  const info = await getDetectedProxyInfo(forceRefresh);
  return info.proxyUrl || null;
}

export async function getTTSProxyAgent(forceRefresh = false) {
  return await getProxyAgent(forceRefresh);
}

export async function ensureProxyDispatcher() {
  await ensureGlobalProxyDispatcher();
}

function generateSecMsGec() {
  let ticks = Date.now() / 1000;
  ticks += WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= S_TO_NS / 100;
  const strToHash = `${Math.floor(ticks)}${TRUSTED_CLIENT_TOKEN}`;
  return crypto.createHash('sha256').update(strToHash, 'ascii').digest('hex').toUpperCase();
}

function generateMuid() {
  return crypto.randomBytes(16).toString('hex').toUpperCase();
}

function escapeXml(unsafe) {
  return String(unsafe).replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

function normalizeRate(rate) {
  if (!rate) return '+0%';
  const trimmed = String(rate).trim();
  if (trimmed.endsWith('%')) {
    return trimmed.startsWith('+') || trimmed.startsWith('-') ? trimmed : `+${trimmed}`;
  }
  const num = parseFloat(trimmed);
  if (!isNaN(num)) {
    const sign = num >= 0 ? '+' : '';
    return `${sign}${Math.round(num * 100)}%`;
  }
  return '+0%';
}

function normalizePitch(pitch) {
  if (!pitch) return '+0Hz';
  const trimmed = String(pitch).trim();
  if (trimmed.endsWith('Hz') || trimmed.endsWith('%')) {
    return trimmed.startsWith('+') || trimmed.startsWith('-') ? trimmed : `+${trimmed}`;
  }
  return '+0Hz';
}

async function attemptSynthesizeOnce(cleanText, options, timeoutMs) {
  const voice = resolveSafeVoice(options.voice);
  const rate = normalizeRate(options.rate);
  const pitch = normalizePitch(options.pitch);
  const volume = options.volume || '+0%';

  const connectionId = crypto.randomUUID().replace(/-/g, '');
  const secMsGec = generateSecMsGec();
  const muid = generateMuid();

  const url = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&ConnectionId=${connectionId}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`;

  const headers = {
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache',
    'Origin': 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
    'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cookie': `muid=${muid};`,
  };

  // Prefer globalThis.WebSocket (built-in to Node 24+ and browsers)
  const WS = globalThis.WebSocket;
  if (!WS) {
    throw new Error('WebSocket is not available in the current environment');
  }

  return new Promise((resolve, reject) => {
    let ws = null;
    let overallTimer = null;
    let inactivityTimer = null;
    let completed = false;
    const audioChunks = [];

    const resetInactivityTimer = () => {
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
      if (!completed) {
        inactivityTimer = setTimeout(() => {
          if (!completed) {
            completed = true;
            cleanup();
            reject(new Error(`TTS synthesis connection stalled: no data received for ${INACTIVITY_TIMEOUT_MS}ms`));
          }
        }, INACTIVITY_TIMEOUT_MS);
      }
    };

    const cleanup = () => {
      if (overallTimer) {
        clearTimeout(overallTimer);
        overallTimer = null;
      }
      if (inactivityTimer) {
        clearTimeout(inactivityTimer);
        inactivityTimer = null;
      }
      if (ws) {
        try {
          ws.onopen = null;
          ws.onmessage = null;
          ws.onerror = null;
          ws.onclose = null;
          ws.close();
        } catch {
          // ignore
        }
        ws = null;
      }
    };

    overallTimer = setTimeout(() => {
      if (!completed) {
        completed = true;
        cleanup();
        reject(new Error(`TTS synthesis timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    resetInactivityTimer();

    try {
      ws = new WS(url, { headers });
    } catch (err) {
      cleanup();
      return reject(err);
    }

    ws.onopen = () => {
      try {
        const configPayload = JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: {
                  sentenceBoundaryEnabled: 'false',
                  wordBoundaryEnabled: 'false',
                },
                outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
              },
            },
          },
        });
        ws?.send(`Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${configPayload}`);

        const requestId = crypto.randomUUID().replace(/-/g, '');
        const ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'><voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${escapeXml(cleanText)}</prosody></voice></speak>`;

        ws?.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n${ssml}`);
      } catch (err) {
        if (!completed) {
          completed = true;
          cleanup();
          reject(err);
        }
      }
    };

    ws.onmessage = async (evt) => {
      if (completed) return;
      resetInactivityTimer();

      const data = evt.data;

      // Handle text messages (e.g. turn.end, turn.start)
      if (typeof data === 'string') {
        if (data.includes('Path:turn.end')) {
          completed = true;
          cleanup();
          if (audioChunks.length === 0) {
            reject(new Error('Edge TTS returned empty audio payload'));
          } else {
            resolve(Buffer.concat(audioChunks));
          }
        }
        return;
      }

      // Handle binary payload (Blob, ArrayBuffer, or Buffer)
      try {
        let buf;
        if (Buffer.isBuffer(data)) {
          buf = data;
        } else if (data instanceof ArrayBuffer) {
          buf = Buffer.from(data);
        } else if (data instanceof Blob) {
          const ab = await data.arrayBuffer();
          buf = Buffer.from(ab);
        }

        if (buf && buf.length > 2) {
          const headerLen = buf.readUInt16BE(0);
          if (buf.length > 2 + headerLen) {
            audioChunks.push(buf.subarray(2 + headerLen));
          }
        }
      } catch (err) {
        console.error('[TTS chunk parse error]:', err);
      }
    };

    ws.onerror = (err) => {
      if (!completed) {
        completed = true;
        cleanup();
        reject(new Error(`Edge TTS connection error: ${err?.message || 'WebSocket failed'}`));
      }
    };

    ws.onclose = (evt) => {
      if (!completed) {
        completed = true;
        cleanup();
        if (audioChunks.length > 0) {
          resolve(Buffer.concat(audioChunks));
        } else {
          reject(new Error(`Edge TTS closed unexpectedly (code: ${evt.code}, reason: ${evt.reason || 'none'})`));
        }
      }
    };
  });
}

/**
 * Synthesizes text to MP3 audio buffer using Microsoft Edge ReadAloud WebSocket API.
 * 策略严格遵循【本地直连优先，失败后自动切换代理重试】
 */
export async function synthesizeEdgeTTS(text, options = {}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) {
    throw new Error('Text to synthesize cannot be empty');
  }

  const dynamicTimeout = Math.min(120000, Math.max(DEFAULT_TIMEOUT_MS, Math.ceil(cleanText.length * 40)));
  const timeoutMs = (typeof options.timeoutMs === 'number' && options.timeoutMs > 0)
    ? options.timeoutMs
    : dynamicTimeout;

  const directAgent = getDirectAgent();
  const proxyAgent = await getTTSProxyAgent();

  // 1. 本地网络直连优先尝试 (Direct-First)
  // 当配置了可用后备代理时，直连握手设置快速超时判定 (3500ms)，避免因 GFW 丢包阻断导致前台白白卡顿数十秒
  const directTimeoutMs = proxyAgent ? Math.min(timeoutMs, 3500) : timeoutMs;
  try {
    setGlobalDispatcher(directAgent);
    return await attemptSynthesizeOnce(cleanText, options, directTimeoutMs);
  } catch (directErr) {
    // 若直连失败且无本地代理可用，直接抛出直连异常
    if (!proxyAgent) {
      throw directErr;
    }

    const proxyUrl = await getDetectedProxyUrl();
    console.warn(`[Edge TTS] 本地网络直连受阻 (${directErr?.message || directErr})，正在无缝切换至本地代理 (${proxyUrl}) 重试...`);

    // 2. 代理无缝降级重试 (Proxy-Fallback)
    try {
      await ensureProxyDispatcher();
      return await attemptSynthesizeOnce(cleanText, options, timeoutMs);
    } catch (proxyErr) {
      // 代理重试若遇到偶发握手重置，支持一次短延迟重试
      const isRetryable =
        proxyErr?.message?.includes('non-101') ||
        proxyErr?.message?.includes('ECONNRESET') ||
        proxyErr?.message?.includes('stalled');

      if (isRetryable) {
        console.warn(`[Edge TTS] 代理重试连接波动 (${proxyErr.message})，600ms 后进行最后一次重试...`);
        await new Promise((r) => setTimeout(r, 600));
        await ensureProxyDispatcher();
        return await attemptSynthesizeOnce(cleanText, options, timeoutMs);
      }
      throw proxyErr;
    }
  }
}
