import { createRuntimePermissionBroker } from '../agents/runtime/runtime-permission-broker.mjs';

// Discovery needs network consent too. Only business calls consume the shared
// operation budget, so loading a schema does not spend a query allowance.
export function taskConnectorPermission(context, { consume = false } = {}) {
  const permissions = context.runtimePermissions ||= createRuntimePermissionBroker({ authorization: context.authorization });
  return consume
    ? permissions.consume('web_research', 'mcp_call')
    : permissions.check('web_research', 'mcp_load');
}

export function callTaskConnectorTool(context, broker, name, args) {
  const permission = taskConnectorPermission(context, { consume: name !== 'mcp_load' });
  if (!permission.allowed) return { ok: false, ...permission };
  return broker.call(name, args);
}
