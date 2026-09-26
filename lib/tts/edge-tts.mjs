import crypto from 'node:crypto';
import { DEFAULT_VOICE_ID, resolveSafeVoice } from './voices.mjs';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const WIN_EPOCH = 11644473600;
const S_TO_NS = 1e9;
const DEFAULT_TIMEOUT_MS = 15000;

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

/**
 * Synthesizes text to MP3 audio buffer using Microsoft Edge ReadAloud WebSocket API.
 * Uses native Node 24 / standard WebSocket client to avoid Next.js bundler bufferutil issues.
 */
export async function synthesizeEdgeTTS(text, options = {}) {
  const cleanText = String(text || '').trim();
  if (!cleanText) {
    throw new Error('Text to synthesize cannot be empty');
  }

  const voice = resolveSafeVoice(options.voice);
  const rate = normalizeRate(options.rate);
  const pitch = normalizePitch(options.pitch);
  const volume = options.volume || '+0%';
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;

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
    let timer = null;
    let completed = false;
    const audioChunks = [];

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
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

    timer = setTimeout(() => {
      if (!completed) {
        completed = true;
        cleanup();
        reject(new Error(`TTS synthesis timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

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
