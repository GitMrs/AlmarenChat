import { smartFetch } from '../web/proxy.ts';

/** HTTP transport shared by SDKs, Pi providers and image model requests. */
export function createModelFetch({ timeoutMs = 600_000, prefer = 'direct-first', fetchImpl = smartFetch } = {}) {
  return async function modelFetch(input, init = {}) {
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
    return fetchImpl(String(url), {
      ...requestInit, prefer, timeoutMs, directTimeoutMs: timeoutMs,
      fallbackOnHttpError: false,
    });
  };
}
