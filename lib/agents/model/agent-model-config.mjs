/** 每个字段逐级继承；空值表示继承，不写回下一级配置。 */
export function resolveAgentModelConfig({ user, agentSetting, member, defaults = {} }) {
  const global = user?.customModelEnabled ? user : null;
  const layers = [['SPACE', member], ['AGENT', agentSetting], ['GLOBAL', global]];
  const customized = layers.find(([, config]) =>
    ['modelName', 'apiBaseUrl', 'apiKey'].some(field => config?.[field]?.trim())
  );
  const field = name => layers.map(([, config]) => config?.[name]?.trim()).find(Boolean) || defaults[name] || null;
  return {
    modelName: field('modelName'),
    apiBaseUrl: field('apiBaseUrl'),
    apiKey: field('apiKey'),
    source: customized?.[0] || 'SYSTEM',
    usesCustomModel: layers.some(([, config]) => Boolean(config?.apiKey?.trim())),
  };
}
