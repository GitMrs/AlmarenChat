import net from 'node:net';
import { Agent, EnvHttpProxyAgent, ProxyAgent, setGlobalDispatcher, fetch as undiciFetch } from 'undici';

export interface ProxyInfo {
  available: boolean;
  proxyUrl?: string;
  port?: number;
  source: 'env' | 'detected' | 'none';
  clientType: 'clash' | 'clash-verge' | 'v2ray' | 'surge' | 'custom' | 'none';
}

export interface ServiceDiagnostic {
  name: string;
  target: string;
  status: 'ok' | 'degraded' | 'failed';
  latencyMs: number;
  usedProxy: boolean;
  message?: string;
}

export interface NetworkDiagnosticsResult {
  ok: boolean;
  timestamp: string;
  proxy: ProxyInfo;
  services: {
    proxy: ServiceDiagnostic;
    tts: ServiceDiagnostic;
    web3: ServiceDiagnostic;
    domestic: ServiceDiagnostic;
  };
  recommendation: string;
}

let cachedProxyInfo: ProxyInfo | null = null;
let cachedProxyAgent: ProxyAgent | null = null;
let lastDetectTime = 0;
const PROXY_DETECT_TTL_MS = 60 * 1000; // 缓存探测结果 1 分钟

/**
 * 快速探测指定本地端口是否处于监听状态
 */
export function checkPortOpen(port: number, host = '127.0.0.1', timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

function resolveClientType(port?: number): ProxyInfo['clientType'] {
  if (!port) return 'none';
  if (port === 7890) return 'clash';
  if (port === 7897) return 'clash-verge';
  if (port === 10809 || port === 10808) return 'v2ray';
  return 'custom';
}

/**
 * 获取当前环境生效的代理配置（优先环境变量，其次探测常见本地代理端口）
 */
export async function getDetectedProxyInfo(forceRefresh = false): Promise<ProxyInfo> {
  const now = Date.now();
  if (!forceRefresh && cachedProxyInfo && now - lastDetectTime < PROXY_DETECT_TTL_MS) {
    return cachedProxyInfo;
  }

  // 1. 优先读取系统环境变量
  const envProxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;

  if (envProxy) {
    let port: number | undefined;
    try {
      const parsed = new URL(envProxy);
      port = parsed.port ? parseInt(parsed.port, 10) : undefined;
    } catch {
      // ignore parse error
    }

    cachedProxyInfo = {
      available: true,
      proxyUrl: envProxy,
      port,
      source: 'env',
      clientType: resolveClientType(port),
    };
    lastDetectTime = now;
    return cachedProxyInfo;
  }

  // 2. 依次探测本地常用开发者代理端口
  const candidatePorts = [7890, 7897, 10809, 10808];
  for (const port of candidatePorts) {
    const isOpen = await checkPortOpen(port);
    if (isOpen) {
      const url = `http://127.0.0.1:${port}`;
      process.env.HTTPS_PROXY = url;
      process.env.HTTP_PROXY = url;

      cachedProxyInfo = {
        available: true,
        proxyUrl: url,
        port,
        source: 'detected',
        clientType: resolveClientType(port),
      };
      lastDetectTime = now;
      return cachedProxyInfo;
    }
  }

  cachedProxyInfo = {
    available: false,
    source: 'none',
    clientType: 'none',
  };
  lastDetectTime = now;
  return cachedProxyInfo;
}

/**
 * 获取可用于 undici 请求的本地 ProxyAgent 实例
 */
export async function getProxyAgent(forceRefresh = false): Promise<ProxyAgent | undefined> {
  const info = await getDetectedProxyInfo(forceRefresh);
  if (!info.available || !info.proxyUrl) return undefined;

  if (!cachedProxyAgent || forceRefresh) {
    try {
      cachedProxyAgent = new ProxyAgent(info.proxyUrl);
    } catch (err) {
      console.warn('[proxy] Failed to create ProxyAgent:', err);
      cachedProxyAgent = null;
    }
  }
  return cachedProxyAgent || undefined;
}

/**
 * 确保 Node 全局调度器启用了环境代理分发器（对原生 WebSocket 和 fetch 均生效）
 */
let globalDispatcherSet = false;
export async function ensureGlobalProxyDispatcher(): Promise<void> {
  try {
    const info = await getDetectedProxyInfo();
    if (info.available && info.proxyUrl) {
      process.env.HTTPS_PROXY = info.proxyUrl;
      process.env.HTTP_PROXY = info.proxyUrl;
      setGlobalDispatcher(new EnvHttpProxyAgent());
      globalDispatcherSet = true;
    }
  } catch (err) {
    console.warn('[proxy] Failed to set global dispatcher:', err);
  }
}

const directAgent = new Agent();

export function getDirectAgent(): Agent {
  return directAgent;
}

export interface SmartFetchOptions extends RequestInit {
  prefer?: 'proxy-first' | 'direct-first' | 'direct-only' | 'proxy-only';
  timeoutMs?: number;
}

/**
 * 智能双轨网络请求助手：
 * 默认策略严格遵循【本地网络直连优先，失败后自动切换代理重试】
 * - prefer 'direct-first' (全网默认): 优先使用本地网络直连；若被阻断或超时，自动无缝切换本地代理重试
 * - prefer 'proxy-first': 优先走代理
 */
export async function smartFetch(url: string, options: SmartFetchOptions = {}): Promise<Response> {
  const { prefer = 'direct-first', timeoutMs = 8000, ...fetchInit } = options;
  const proxyAgent = await getProxyAgent();

  const executeFetch = async (useProxy: boolean, customTimeoutMs?: number): Promise<Response> => {
    const effTimeout = customTimeoutMs || timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effTimeout);
    try {
      if (useProxy && proxyAgent) {
        return (await undiciFetch(url, {
          ...fetchInit,
          dispatcher: proxyAgent,
          signal: controller.signal,
        } as any)) as unknown as Response;
      }
      return (await undiciFetch(url, {
        ...fetchInit,
        dispatcher: directAgent,
        signal: controller.signal,
      } as any)) as unknown as Response;
    } finally {
      clearTimeout(timer);
    }
  };

  // 1. 如果指定仅限代理或仅限直连
  if (prefer === 'proxy-only') {
    return await executeFetch(true);
  }
  if (prefer === 'direct-only') {
    return await executeFetch(false);
  }

  // 2. 代理优先策略 (Proxy-First)
  if (prefer === 'proxy-first') {
    if (proxyAgent) {
      try {
        const res = await executeFetch(true);
        if (res.ok) return res;
      } catch (err: any) {
        console.warn(`[smartFetch] Proxy attempt failed for ${url}:`, err?.message || err);
      }
    }
    // 降级直连
    return await executeFetch(false);
  }

  // 3. 直连优先策略 (Direct-First) - 全局默认
  // 当配置了可用代理时，本地直连尝试设置紧凑超时 (3000ms)，避免因 GFW 丢包导致长时间假死
  const directTimeout = proxyAgent ? Math.min(timeoutMs, 3200) : timeoutMs;
  try {
    const res = await executeFetch(false, directTimeout);
    if (res.ok) return res;

    // 若直连返回异常状态（如 403 / 502 / 429）且有本地代理，则无缝切换代理
    if (proxyAgent) {
      console.warn(`[smartFetch] Direct attempt returned status ${res.status} for ${url}, retrying via proxy...`);
      return await executeFetch(true, timeoutMs);
    }
    return res;
  } catch (err: any) {
    if (proxyAgent) {
      console.warn(`[smartFetch] Direct attempt failed for ${url} (${err?.message || err}), retrying via proxy...`);
      return await executeFetch(true, timeoutMs);
    }
    throw err;
  }
}

/**
 * 执行完整的系统网络连通性诊断测试
 */
export async function runNetworkDiagnostics(): Promise<NetworkDiagnosticsResult> {
  const proxyInfo = await getDetectedProxyInfo(true);
  const proxyAgent = await getProxyAgent(true);

  // 1. 代理端口检测
  let proxyStatus: ServiceDiagnostic['status'] = 'failed';
  let proxyLatency = 0;
  let proxyMsg = '未检测到活跃的本地代理客户端（如 Clash 7890 / 7897）';

  if (proxyInfo.available && proxyInfo.port) {
    const t0 = Date.now();
    const isOpen = await checkPortOpen(proxyInfo.port, '127.0.0.1', 500);
    proxyLatency = Date.now() - t0;
    if (isOpen) {
      proxyStatus = 'ok';
      proxyMsg = `本地 ${proxyInfo.clientType.toUpperCase()} 代理活跃 (127.0.0.1:${proxyInfo.port})`;
    } else {
      proxyStatus = 'degraded';
      proxyMsg = `配置了代理端口 ${proxyInfo.port}，但端口当前无法连通`;
    }
  }

  // 2. 国内源连通测试 (以百度热搜 Wise 接口为例)
  let domesticStatus: ServiceDiagnostic['status'] = 'failed';
  let domesticLatency = 0;
  let domesticMsg = '';
  try {
    const t0 = Date.now();
    const res = await smartFetch('https://top.baidu.com/api/board?platform=wise&tab=realtime', {
      prefer: 'direct-first',
      timeoutMs: 4000,
    });
    domesticLatency = Date.now() - t0;
    if (res.ok) {
      domesticStatus = 'ok';
      domesticMsg = `连通顺畅 (${domesticLatency}ms)`;
    } else {
      domesticStatus = 'degraded';
      domesticMsg = `响应状态 HTTP ${res.status}`;
    }
  } catch (err: any) {
    domesticMsg = `连接超时或失败: ${err?.message || '网络错误'}`;
  }

  // 3. 海外 / Web3 源连通测试 (以 OKX 星球为例)
  let web3Status: ServiceDiagnostic['status'] = 'failed';
  let web3Latency = 0;
  let web3Msg = '';
  let web3UsedProxy = false;
  try {
    const t0 = Date.now();
    const res = await smartFetch('https://www.okx.com/zh-hans/orbit/topics', {
      prefer: 'direct-first',
      timeoutMs: 6000,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
      },
    });
    web3Latency = Date.now() - t0;
    web3UsedProxy = Boolean(proxyAgent);
    if (res.ok) {
      web3Status = 'ok';
      const modeNote = web3Latency > 2800 && proxyAgent ? ' [直连受阻，已由代理自动接管]' : ' [本地直连]';
      web3Msg = `连通顺畅 (${web3Latency}ms)${modeNote}`;
    } else {
      web3Status = 'degraded';
      web3Msg = `响应状态 HTTP ${res.status}`;
    }
  } catch (err: any) {
    web3Msg = proxyInfo.available
      ? `代理连接失败: ${err?.message || '超时'}`
      : '直连被阻断，建议开启 7890 代理客户端后重试';
  }

  // 4. Edge TTS 语音服务连通性测试 (微软 WebSocket 端点连通测试)
  let ttsStatus: ServiceDiagnostic['status'] = 'failed';
  let ttsLatency = 0;
  let ttsMsg = '';
  try {
    const t0 = Date.now();
    // 使用 HEAD/GET 握手探测 speech.platform.bing.com 是否通达
    const res = await smartFetch(
      'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=6A5AA1D4EAFF4E9FB37E23D68491D6F4',
      {
        prefer: 'direct-first',
        timeoutMs: 6000,
        headers: {
          Pragma: 'no-cache',
          'Cache-Control': 'no-cache',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/143.0.0.0',
        },
      }
    );
    ttsLatency = Date.now() - t0;
    if (res.status === 200 || res.status === 404 || res.status === 400) {
      // 微软只要回应 HTTP 状态说明 SSL/网络通路完全正常
      ttsStatus = 'ok';
      const modeNote = ttsLatency > 2800 && proxyAgent ? ' [直连受阻，已由代理自动接管]' : ' [本地直连]';
      ttsMsg = `连通顺畅 (${ttsLatency}ms)${modeNote}`;
    } else {
      ttsStatus = 'degraded';
      ttsMsg = `状态码 HTTP ${res.status}`;
    }
  } catch (err: any) {
    ttsMsg = proxyInfo.available
      ? `语音服务受阻: ${err?.message || '网络重置'}`
      : '语音服务无法直连，需开启 7890 代理客户端';
  }

  // 综合判定
  const allGood = domesticStatus === 'ok' && (proxyStatus === 'ok' || web3Status === 'ok');
  let recommendation = '网络状态极佳，全网数据源与 AI 语音播报均处于最优状态。';

  if (!proxyInfo.available || proxyStatus !== 'ok') {
    recommendation =
      '⚠️ 未检测到活跃的本地网络代理（如 Clash 7890）。国内热搜正常，但 OKX、CoinDesk 及 AI 早报播音可能会受阻，建议启动代理客户端。';
  } else if (web3Status !== 'ok' || ttsStatus !== 'ok') {
    recommendation =
      '⚠️ 代理客户端已启动，但海外节点访问微软 TTS 或 OKX 偶发延迟或失败，建议在代理软件中切换为可用延迟较低的节点。';
  }

  return {
    ok: allGood,
    timestamp: new Date().toISOString(),
    proxy: proxyInfo,
    services: {
      proxy: {
        name: '本地代理中枢',
        target: proxyInfo.proxyUrl || '127.0.0.1',
        status: proxyStatus,
        latencyMs: proxyLatency,
        usedProxy: false,
        message: proxyMsg,
      },
      tts: {
        name: '微软 Edge TTS 语音服务',
        target: 'speech.platform.bing.com',
        status: ttsStatus,
        latencyMs: ttsLatency,
        usedProxy: Boolean(proxyAgent),
        message: ttsMsg,
      },
      web3: {
        name: 'OKX / 加密 Web3 数据源',
        target: 'www.okx.com',
        status: web3Status,
        latencyMs: web3Latency,
        usedProxy: web3UsedProxy,
        message: web3Msg,
      },
      domestic: {
        name: '国内主流热搜源 (百度/知乎)',
        target: 'top.baidu.com',
        status: domesticStatus,
        latencyMs: domesticLatency,
        usedProxy: false,
        message: domesticMsg,
      },
    },
    recommendation,
  };
}
