import { capabilityCatalog } from './registry.mjs';
import { resolveCapabilities } from './resolver.mjs';

/**
 * Return user-facing capability status without exposing implementation tool names.
 * This is discovery only; it never changes permissions or loads an executor.
 */
export function describeCapabilities({
  entry,
  query = '',
  enabledCapabilities = [],
  requestedCapabilities = [],
  permittedCapabilities = undefined,
  disabledCapabilities = [],
  phase = 'chat',
  availableToolNames = undefined,
  loadableCapabilities = [],
} = {}) {
  const available = Array.isArray(availableToolNames) ? new Set(availableToolNames) : null;
  const enabled = new Set((Array.isArray(enabledCapabilities) ? enabledCapabilities : []).map(String));
  const permitted = new Set((Array.isArray(permittedCapabilities) ? permittedCapabilities : []).map(String));
  const resolution = resolveCapabilities({
    entry,
    query,
    phase,
    enabledCapabilities,
    requestedCapabilities,
    permittedCapabilities,
    disabledCapabilities,
  });
  const catalog = capabilityCatalog(entry);
  const loaded = available
    ? new Set(catalog.filter((capability) => capability.tools.some((name) => available.has(name))).map((capability) => capability.id))
    : new Set(resolution.capabilities);
  const disabled = new Set((Array.isArray(disabledCapabilities) ? disabledCapabilities : []).map(String));
  const loadable = new Set(loadableCapabilities);
  const capabilities = catalog.map((capability) => {
    let status = '可按需使用';
    let hint = '提出相关需求时会加载。';
    if (disabled.has(capability.id)
      || (capability.owner === 'external' && Array.isArray(permittedCapabilities) && !permitted.has(capability.id))) {
      status = '当前不可用';
      hint = '当前作用域或权限已禁用。';
    } else if (available && !capability.tools.some((name) => available.has(name)) && loadable.has(capability.id)) {
      status = '可按需使用';
      hint = '本轮尚未加载；需要时可先加载对应工具，再执行操作。';
    } else if (available && !capability.tools.some((name) => available.has(name))) {
      status = '当前不可用';
      hint = '本轮未提供此能力的工具；不代表已经授权或接入，需要按当前入口与需求确认。';
    } else if (available && capability.owner === 'external') {
      status = '本轮已加载';
      hint = '本轮已提供对应查询工具；是否取得数据以实际调用结果为准。';
    } else if (loaded.has(capability.id) && (capability.activation === 'core' || capability.activation === 'scope_default')) {
      status = '默认可用';
      hint = '当前入口默认提供。';
    } else if (enabled.has(capability.id) || permitted.has(capability.id)) {
      status = '已启用';
      hint = '当前入口已允许使用。';
    } else if (capability.activation === 'explicit_confirm') {
      status = '需要开启';
      hint = '当前入口尚未授权或接入此能力；如为账号能力，需要先完成对应账号配置。';
    }
    return { id: capability.id, label: capability.label, owner: capability.owner, status, hint };
  });
  return { entry, phase, capabilities, loaded: [...loaded].filter((id) => capabilities.some((item) => item.id === id && item.status !== '当前不可用')), notices: resolution.notices };
}

export function createCapabilityHelpTool(options = {}) {
  const tool = {
    type: 'function',
    function: {
      name: 'capability_help',
      description: '查看当前角色、入口或空间可用的能力状态；只读，不会开启能力或执行外部操作。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
    },
  };
  return {
    tool,
    execute: async (_args = undefined) => ({ ok: true, ...describeCapabilities({
      ...options,
      ...(typeof options.getAvailableToolNames === 'function' ? { availableToolNames: options.getAvailableToolNames() } : {}),
    }) }),
  };
}
