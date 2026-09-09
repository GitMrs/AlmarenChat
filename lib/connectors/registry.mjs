export const CONNECTOR_PROVIDERS = Object.freeze({
  WECHAT_OFFICIAL_ACCOUNT: Object.freeze({
    id: 'WECHAT_OFFICIAL_ACCOUNT',
    name: '微信公众号',
    credentialFields: Object.freeze(['appSecret']),
    publicFields: Object.freeze(['appId']),
    actions: Object.freeze({
      WECHAT_VALIDATE_CONNECTION: Object.freeze({ riskLevel: 'LOW', approvalRequired: false }),
      WECHAT_CREATE_DRAFT: Object.freeze({ riskLevel: 'HIGH', approvalRequired: true }),
      WECHAT_PUBLISH: Object.freeze({ riskLevel: 'HIGH', approvalRequired: true }),
    }),
  }),
});

export function connectorDefinition(provider) {
  return CONNECTOR_PROVIDERS[String(provider || '').trim().toUpperCase()] || null;
}

export function connectorActionDefinition(provider, actionKind) {
  return connectorDefinition(provider)?.actions?.[String(actionKind || '').trim().toUpperCase()] || null;
}

export function canRetryConnectorStatus(action) {
  return action?.kind === 'WECHAT_PUBLISH'
    && action?.status === 'FAILED'
    && typeof action?.connectorExecution?.externalId === 'string'
    && action.connectorExecution.externalId.length > 0;
}

export function serializeConnector(connector) {
  const definition = connectorDefinition(connector?.provider);
  const publicConfig = connector?.publicConfig && typeof connector.publicConfig === 'object'
    ? connector.publicConfig
    : {};
  const allowedConfig = Object.fromEntries(
    (definition?.publicFields || []).filter((key) => typeof publicConfig[key] === 'string').map((key) => [key, publicConfig[key]])
  );
  return {
    id: connector.id,
    spaceId: connector.spaceId,
    provider: connector.provider,
    providerName: definition?.name || connector.provider,
    enabled: Boolean(connector.enabled),
    configured: Boolean(connector.credentialCiphertext),
    status: connector.enabled ? connector.status : 'DISABLED',
    publicConfig: allowedConfig,
    lastCheckedAt: connector.lastCheckedAt?.toISOString?.() || connector.lastCheckedAt || null,
    lastError: connector.lastError || null,
    createdAt: connector.createdAt?.toISOString?.() || connector.createdAt,
    updatedAt: connector.updatedAt?.toISOString?.() || connector.updatedAt,
  };
}
