function templateValue(payload, path) {
  const parts = String(path || '').split('.');
  if (!parts.length || !['version', 'event', 'idempotencyKey', 'occurredAt', 'source', 'run', 'content'].includes(parts[0])) return undefined;
  let value = payload;
  for (const part of parts) {
    if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, part)) return undefined;
    value = value[part];
  }
  return value;
}

export function renderWebhookTemplate(template, payload) {
  if (Array.isArray(template)) return template.map((value) => renderWebhookTemplate(value, payload));
  if (template && typeof template === 'object') {
    return Object.fromEntries(Object.entries(template).map(([key, value]) => [key, renderWebhookTemplate(value, payload)]));
  }
  if (typeof template !== 'string') return template;
  const exact = template.match(/^\{\{([A-Za-z][A-Za-z0-9_.]*)\}\}$/);
  if (exact) return templateValue(payload, exact[1]) ?? '';
  return template.replace(/\{\{([A-Za-z][A-Za-z0-9_.]*)\}\}/g, (_match, path) => {
    const value = templateValue(payload, path);
    return value === undefined || value === null
      ? ''
      : typeof value === 'object' ? JSON.stringify(value) : String(value);
  });
}
