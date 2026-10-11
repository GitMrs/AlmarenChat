const TRANSIENT_WEB_SEARCH_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 522, 524]);
const TRANSIENT_NETWORK_CODES = /^(?:ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|UND_ERR_SOCKET|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)$/;

function errorStatus(error) {
  return Number(error?.status || error?.statusCode || error?.response?.status || 0);
}

function errorCode(error) {
  return String(error?.cause?.code || error?.code || '');
}

export function isTransientWebSearchError(error) {
  const status = errorStatus(error);
  const code = errorCode(error);
  const message = String(error?.message || '');
  return TRANSIENT_WEB_SEARCH_STATUSES.has(status)
    || /\b(?:408|429|500|502|503|504|520|522|524)\b/.test(message)
    || /(?:timed?\s*out|timeout|terminated|fetch failed|socket hang up|premature close|connection (?:closed|reset)|other side closed)/i.test(message)
    || TRANSIENT_NETWORK_CODES.test(code);
}

export function describeWebSearchError(error) {
  const status = errorStatus(error);
  if (status) return `HTTP ${status}`;
  const code = errorCode(error);
  if (code) return code;
  const statusMatch = String(error?.message || '').match(/\b(?:408|429|500|502|503|504|520|522|524)\b/);
  return statusMatch ? `HTTP ${statusMatch[0]}` : 'temporary network error';
}
