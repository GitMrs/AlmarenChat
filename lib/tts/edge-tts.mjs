import crypto from 'node:crypto';
import { WebSocket } from 'undici';
import { channel } from 'node:diagnostics_channel';
import { generateSecMsGec, TRUSTED_CLIENT_TOKEN, CHROMIUM_FULL_VERSION, SEC_MS_GEC_VERSION } from './edge-gec.mjs';
import { DEFAULT_VOICE_ID, resolveSafeVoice } from './voices.mjs';

const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0];
const DEFAULT_TIMEOUT_MS = 60000;
const INACTIVITY_TIMEOUT_MS = 30000;

import {
  checkPortOpen,
  getDirectAgent,
  getProxyAgent,
  getDetectedProxyInfo,
  ensureGlobalProxyDispatcher,
} from '../web/proxy.ts';

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

async function attemptSynthesizeOnce(cleanText, options, timeoutMs, dispatcher, connectTimeoutMs = timeoutMs) {
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

  return new Promise((resolve, reject) => {
    let ws = null;
    let overallTimer = null;
    let inactivityTimer = null;
    let connectTimer = null;
    let upstreamStatus = null;
    let completed = false;
    const audioChunks = [];
    // Match only this request; never log signed URLs or request headers.
    const headersChannel = channel('undici:request:headers');
    const observeHeaders = ({ request, response }) => {
      if (request.path?.includes(`ConnectionId=${connectionId}`)) upstreamStatus = response.statusCode;
    };
    headersChannel.subscribe(observeHeaders);

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
      headersChannel.unsubscribe(observeHeaders);
      if (connectTimer) clearTimeout(connectTimer);
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
      ws = new WebSocket(url, { headers, dispatcher });
      ws.binaryType = 'arraybuffer';
      connectTimer = setTimeout(() => {
        if (!completed) {
          completed = true;
          cleanup();
          reject(new Error(`TTS handshake timed out after ${connectTimeoutMs}ms`));
        }
      }, connectTimeoutMs);
    } catch (err) {
      cleanup();
      return reject(err);
    }

    ws.onopen = () => {
      clearTimeout(connectTimer);
      connectTimer = null;
      resetInactivityTimer();
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
        const error = new Error(upstreamStatus
          ? `Edge TTS handshake rejected (HTTP ${upstreamStatus})`
          : `Edge TTS connection error: ${err?.message || 'WebSocket failed'}`);
        error.status = upstreamStatus;
        error.code = upstreamStatus === 403 ? 'TTS_HANDSHAKE_FORBIDDEN' : 'TTS_CONNECTION_ERROR';
        reject(error);
      }
    };

    ws.onclose = (evt) => {
      if (!completed) {
        completed = true;
        cleanup();
        reject(new Error(`Edge TTS closed before turn.end (code: ${evt.code}, reason: ${evt.reason || 'none'})`));
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
  // 有后备代理时，仅将直连握手限制为 3500ms；连接成功后保留完整合成预算。
  const directTimeoutMs = proxyAgent ? Math.min(timeoutMs, 3500) : timeoutMs;
  try {
    return await attemptSynthesizeOnce(cleanText, options, timeoutMs, directAgent, directTimeoutMs);
  } catch (directErr) {
    if (directErr.status === 403) throw directErr;
    // 若直连失败且无本地代理可用，直接抛出直连异常
    if (!proxyAgent) {
      throw directErr;
    }

    const proxyUrl = await getDetectedProxyUrl();
    console.warn(`[Edge TTS] 本地网络直连受阻 (${directErr?.message || directErr})，正在无缝切换至本地代理 (${proxyUrl}) 重试...`);

    // 2. 代理无缝降级重试 (Proxy-Fallback)
    try {
      return await attemptSynthesizeOnce(cleanText, options, timeoutMs, proxyAgent);
    } catch (proxyErr) {
      if (proxyErr.status === 403) throw proxyErr;
      // 代理重试若遇到偶发握手重置，支持一次短延迟重试
      const isRetryable =
        proxyErr?.message?.includes('non-101') ||
        proxyErr?.message?.includes('ECONNRESET') ||
        proxyErr?.message?.includes('stalled');

      if (isRetryable) {
        console.warn(`[Edge TTS] 代理重试连接波动 (${proxyErr.message})，600ms 后进行最后一次重试...`);
        await new Promise((r) => setTimeout(r, 600));
        return await attemptSynthesizeOnce(cleanText, options, timeoutMs, proxyAgent);
      }
      throw proxyErr;
    }
  }
}
