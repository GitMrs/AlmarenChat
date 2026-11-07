/**
 * Stable capability metadata. Tool implementations remain in their existing
 * modules; this registry only describes ownership, scope and activation.
 */
const CAPABILITIES = [
  {
    id: 'assistant_memory', label: '聊天记忆', owner: 'assistant',
    scope: ['assistant'], activation: 'core', risk: 'read_only',
    tools: ['memory_search', 'memory_read'],
  },
  {
    id: 'agent_memory', label: 'Agent 记忆', owner: 'agent',
    scope: ['agent', 'space'], activation: 'core', risk: 'read_only',
    tools: ['memory_search', 'memory_read'],
  },
  {
    id: 'agent_growth', label: 'Agent 成长记录', owner: 'agent',
    scope: ['agent', 'space'], activation: 'core', risk: 'write_scoped',
    tools: ['growth_commit'],
  },
  {
    id: 'space_runtime', label: '空间运行', owner: 'space',
    scope: ['space', 'task'], activation: 'scope_default', risk: 'scoped',
    tools: ['coordinate_members', 'propose_task', 'start_relay', 'start_group_chat', 'workspace_load'],
  },
  {
    id: 'space_read', label: '空间文件读取', owner: 'space',
    scope: ['space', 'task'], activation: 'scope_default', risk: 'read_only',
    tools: ['read_file', 'list_files', 'check_files'],
  },
  {
    id: 'space_workspace', label: '空间文件与页面', owner: 'space',
    scope: ['space', 'task'], activation: 'scope_default', risk: 'write_scoped',
    tools: ['write_file', 'patch_file', 'patch_files', 'run_check', 'generate_images', 'generate_image'],
  },
  {
    id: 'space_skills', label: '空间 Skill', owner: 'space',
    scope: ['space', 'task'], activation: 'scope_default', risk: 'execute_scoped',
    tools: ['read_skill_file', 'read_skill_package_file', 'run_skill', 'request_skill_permission'],
  },
  {
    id: 'space_tasks', label: '空间任务执行', owner: 'space',
    scope: ['task'], activation: 'scope_default', risk: 'execute_scoped',
    tools: ['submit_task_result', 'request_user_input'],
  },
  {
    id: 'web', label: '联网搜索', owner: 'external',
    description: '搜索公开互联网、读取网页，查找最新资料与信息来源。',
    settingsHref: '/me?tab=settings', settingsLabel: '搜索服务设置',
    scope: ['assistant', 'agent', 'space', 'task'], activation: 'on_demand', risk: 'read_external',
    tools: ['web_search', 'web_fetch'], triggers: ['联网', '搜索', '查资料', '网页', '最新'],
  },
  {
    id: 'weather', label: '天气查询', owner: 'external',
    description: '查询城市实况天气及预报，支持设置默认天气地点。',
    settingsHref: '/me?tab=settings', settingsLabel: '默认地点设置',
    scope: ['assistant', 'agent', 'space'], activation: 'on_demand', risk: 'read_external',
    tools: ['weather_query'], triggers: ['天气', '气温', '下雨', '温度', '预报'],
  },
  {
    id: 'trending', label: '热榜查询', owner: 'external',
    description: '查询各平台热榜、热搜与热门话题。',
    scope: ['assistant', 'agent', 'space'], activation: 'on_demand', risk: 'read_external',
    tools: ['trending_query'], triggers: ['热榜', '热搜', '热门', '趋势'],
  },
  {
    id: 'crypto', label: '加密行情', owner: 'external',
    description: '只读查询加密货币价格与市场快照，不执行交易。',
    scope: ['assistant', 'agent', 'space'], activation: 'on_demand', risk: 'read_external',
    tools: ['crypto_quote', 'crypto_market_snapshot'], triggers: ['比特币', '以太坊', '加密', '币价', '行情'],
  },
  {
    id: 'bilibili', label: 'Bilibili', owner: 'external',
    description: '查询视频、发现内容及读取已授权的账号资料。',
    availabilityNote: '目前用于 Bilibili 创作空间及其任务，普通小伴和 Agent 聊天尚未接入。账号数据需在对应空间完成账号配置。',
    settingsHref: '/spaces', settingsLabel: '前往空间',
    scope: ['assistant', 'agent', 'space', 'task'], activation: 'explicit_confirm', risk: 'account_external',
    tools: ['bilibili_account', 'bilibili_search', 'bilibili_video', 'bilibili_discover'],
    triggers: ['B站', 'Bilibili', '哔哩哔哩'],
  },
  {
    id: 'mcp', label: '已配置 MCP 服务入口', owner: 'external',
    description: '接入地图、外部数据源等 MCP 服务，按服务加载其能力。',
    availabilityNote: '小伴使用个人中心配置的服务；空间任务使用对应空间的服务配置与授权。各服务已有独立启停设置。',
    settingsHref: '/me?tab=mcp', settingsLabel: '管理 MCP 服务',
    scope: ['assistant', 'task'], activation: 'explicit_confirm', risk: 'account_external',
    tools: ['mcp_load'],
  },
];

function freezeCapability(capability) {
  return Object.freeze({
    ...capability,
    scope: Object.freeze([...capability.scope]),
    tools: Object.freeze([...capability.tools]),
    ...(capability.triggers ? { triggers: Object.freeze([...capability.triggers]) } : {}),
  });
}

export const CAPABILITY_REGISTRY = Object.freeze(CAPABILITIES.map(freezeCapability));

export function getCapability(id) {
  return CAPABILITY_REGISTRY.find(capability => capability.id === id) || null;
}

export function getCapabilitiesForEntry(entry, { owner = undefined } = {}) {
  return CAPABILITY_REGISTRY.filter(capability => capability.scope.includes(entry)
    && (owner === undefined || capability.owner === owner));
}

export function getReadOnlyExternalCapabilityIds(entry) {
  return getCapabilitiesForEntry(entry, { owner: 'external' })
    .filter(capability => capability.activation === 'on_demand' && capability.risk === 'read_external')
    .map(capability => capability.id);
}

export function getCapabilityForTool(toolName) {
  return CAPABILITY_REGISTRY.find(capability => capability.tools.includes(toolName)) || null;
}

export function getCapabilitiesForTool(toolName) {
  return CAPABILITY_REGISTRY.filter(capability => capability.tools.includes(toolName));
}

export function capabilityCatalog(entry, options = {}) {
  return getCapabilitiesForEntry(entry, options).map(({ id, label, owner, activation, risk, tools, triggers }) => ({
    id, label, owner, activation, risk, tools: [...tools], ...(triggers ? { triggers: [...triggers] } : {}),
  }));
}

