import { smartFetch } from '../web/proxy.ts';
import { randomUUID } from 'node:crypto';

/** HTTP transport shared by SDKs, Pi providers and image model requests. */
export function createModelFetch({ timeoutMs = 600_000, prefer = 'direct-first', fetchImpl = smartFetch, log = event => console.warn('[model-network]', event), now = Date.now } = {}) {
  return async function modelFetch(input, init = {}) {
    const startedAt = now();
    const requestId = randomUUID();
    let url = input;
    let requestInit = init;
    if (typeof Request !== 'undefined' && input instanceof Request) {
      const request = new Request(input, init);
      request.signal.throwIfAborted();
      url = request.url;
      requestInit = {
        method: request.method, headers: request.headers, signal: request.signal,
        redirect: request.redirect,
        // Buffer Request bodies so the same payload can be used on fallback.
        ...(request.body ? { body: await request.arrayBuffer() } : {}),
      };
    }
    // The SDK exposes a per-call timeout in this header. Keep short summary calls
    // inside that budget instead of resetting the full client timeout per route.
    const sdkTimeout = Number(new Headers(requestInit.headers).get('x-stainless-timeout')) * 1000;
    const budget = sdkTimeout > 0 && Number.isFinite(sdkTimeout) ? Math.min(timeoutMs, sdkTimeout) : timeoutMs;
    const controller = new AbortController();
    const signal = requestInit.signal ? AbortSignal.any([requestInit.signal, controller.signal]) : controller.signal;
    let route = 'direct';
    let headersReceived = false;
    let firstChunk = false;
    let finished = false;
    let onBodyAbort;
    const timeoutError = Object.assign(new Error('Request timed out.'), { name: 'TimeoutError', code: 'MODEL_REQUEST_TIMEOUT' });
    const timer = setTimeout(() => controller.abort(timeoutError), budget);
    timer.unref?.();
    const debug = process.env.MODEL_NETWORK_DEBUG === '1';
    const emit = (stage, error, status) => {
      if (!debug && !error && !(status >= 400)) return;
      // Whitelist metadata: no URLs, headers, payloads or raw error messages.
      let code;
      for (let cause = error, depth = 0; cause && depth < 4; cause = cause.cause, depth++) {
        if (typeof cause.code === 'string' && /^[A-Z_0-9]{1,64}$/.test(cause.code)) { code = cause.code; break; }
      }
      try { log({ requestId, stage, route, phase: headersReceived ? firstChunk ? 'stream' : 'first-chunk' : 'connection-or-headers', durationMs: now() - startedAt, timeoutMs: budget, ...(status ? { status } : {}), ...(error ? { errorName: /^[A-Za-z]{1,64}$/.test(error.name) ? error.name : 'Error', code } : {}) }); } catch { /* logging is best-effort */ }
    };
    const finish = (stage, error) => {
      if (finished) return false;
      finished = true;
      clearTimeout(timer);
      if (onBodyAbort) signal.removeEventListener('abort', onBodyAbort);
      emit(stage, error);
      return true;
    };
    const errorStage = () => signal.aborted
      ? controller.signal.aborted || now() - startedAt >= budget - 50 ? 'request-timeout' : 'request-aborted'
      : headersReceived ? firstChunk ? 'stream-error' : 'first-chunk-error' : 'connection-or-headers-error';
    try {
      signal.throwIfAborted();
      const response = await fetchImpl(String(url), {
        ...requestInit, signal, prefer, timeoutMs: budget, directTimeoutMs: budget,
        fallbackOnHttpError: false, modelTransport: true,
        onAttempt: event => {
          route = event.route;
          emit(event.stage, event.error, event.status);
        },
      });
      headersReceived = true;
      if (!response.body) { finish('response-complete'); return response; }
      const reader = response.body.getReader();
      const body = new ReadableStream({
        start(stream) {
          onBodyAbort = () => {
            const error = signal.reason;
            if (!finish(errorStage(), error)) return;
            stream.error(error);
            void reader.cancel(error).catch(() => {});
          };
          signal.addEventListener('abort', onBodyAbort, { once: true });
          if (signal.aborted) onBodyAbort();
        },
        async pull(stream) {
          try {
            const chunk = await reader.read();
            if (finished) return;
            if (chunk.done) { finish('response-complete'); stream.close(); }
            else {
              if (!firstChunk) { firstChunk = true; emit('first-chunk'); }
              stream.enqueue(chunk.value);
            }
          } catch (error) { if (finish(errorStage(), error)) stream.error(error); }
        },
        async cancel(reason) {
          finish('response-cancelled');
          controller.abort(reason);
          await reader.cancel(reason);
        },
      });
      const wrapped = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      Object.defineProperty(wrapped, 'url', { value: response.url });
      return wrapped;
    } catch (error) {
      finish(errorStage(), error);
      throw error;
    }
  };
}
