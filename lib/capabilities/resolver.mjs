import { getCapabilitiesForEntry } from './registry.mjs';

const EXTERNAL_OWNERS = new Set(['external']);
const PHASES = new Set(['chat', 'explore', 'artifact', 'task']);

function normalizeSet(value) {
  return new Set(Array.isArray(value) ? value.map(String) : []);
}

function matchesTrigger(capability, query) {
  const text = String(query || '').trim().toLowerCase();
  return Boolean(text && capability.triggers?.some(trigger => text.includes(trigger.toLowerCase())));
}

function phaseAllows(capability, phase) {
  if (capability.id === 'space_workspace') return phase === 'artifact' || phase === 'task';
  if (capability.id === 'space_tasks') return phase === 'task';
  return true;
}

/**
 * Resolve capability IDs and tool names for one model turn.
 * This is intentionally pure: permission checks and tool execution remain in
 * the existing route/broker implementations until each entry is migrated.
 */
export function resolveCapabilities({
  entry,
  query = '',
  phase = 'chat',
  enabledCapabilities = [],
  requestedCapabilities = [],
  permittedCapabilities = undefined,
  disabledCapabilities = [],
} = {}) {
  if (!['assistant', 'agent', 'space', 'task'].includes(entry)) {
    return { capabilities: [], tools: [], unavailable: [], notices: ['未知入口，未加载工具'] };
  }
  const currentPhase = PHASES.has(phase) ? phase : 'chat';
  const enabled = normalizeSet(enabledCapabilities);
  const requested = normalizeSet(requestedCapabilities);
  const permitted = normalizeSet(permittedCapabilities);
  const disabled = normalizeSet(disabledCapabilities);
  const candidates = getCapabilitiesForEntry(entry).filter(capability => phaseAllows(capability, currentPhase));
  const selected = [];
  const unavailable = [];
  for (const capability of candidates) {
    if (disabled.has(capability.id)) continue;
    if (capability.activation === 'core' || capability.activation === 'scope_default') {
      selected.push(capability);
      continue;
    }
    if (!EXTERNAL_OWNERS.has(capability.owner)) continue;
    if (Array.isArray(permittedCapabilities) && !permitted.has(capability.id)) continue;
    const explicit = enabled.has(capability.id);
    const triggered = matchesTrigger(capability, query);
    if (capability.activation === 'explicit_confirm') {
      if ((explicit || permitted.has(capability.id)) && (triggered || requested.has(capability.id))) selected.push(capability);
      else if (triggered) unavailable.push({ id: capability.id, label: capability.label, reason: '需要先启用此能力' });
      continue;
    }
    if (triggered || requested.has(capability.id)) selected.push(capability);
  }
  const unique = new Map(selected.map(capability => [capability.id, capability]));
  const capabilities = [...unique.values()];
  return {
    capabilities: capabilities.map(capability => capability.id),
    tools: [...new Set(capabilities.flatMap(capability => capability.tools))],
    unavailable,
    notices: unavailable.length ? unavailable.map(item => `${item.label}：${item.reason}`) : [],
  };
}

export function filterToolSchemas(schemas, resolution) {
  const allowed = new Set(resolution?.tools || []);
  return (Array.isArray(schemas) ? schemas : []).filter(schema => allowed.has(schema?.function?.name));
}

