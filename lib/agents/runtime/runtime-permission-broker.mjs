/**
 * Runtime capability gate shared by Native, Worker and Pi execution paths.
 * Proposal metadata never grants a capability; the authorization package does.
 */
export function createRuntimePermissionBroker({ authorization = {}, operationLimit = 2 } = {}) {
  let operationCount = 0;
  const limit = Math.max(0, Math.trunc(Number(operationLimit) || 0));

  function check(capability, operation = capability) {
    const capabilities = Array.isArray(authorization.capabilities) ? authorization.capabilities : [];
    if (!capabilities.includes(capability)) {
      return { allowed: false, code: 'CAPABILITY_DENIED', error: `当前运行未授权 ${capability}` };
    }
    if (capability === 'web_research') {
      if (authorization.networkPolicy === 'forbidden') return { allowed: false, code: 'NETWORK_DISABLED', error: '本轮没有获得联网权限' };
      const decision = authorization.networkDecision || (authorization.networkPolicy === 'allowed' ? 'allowed' : authorization.networkPolicy === 'runtime' ? 'pending' : 'allowed');
      if (decision === 'denied') return { allowed: false, code: 'NETWORK_DENIED', error: '用户拒绝了本轮联网查询' };
      if (decision !== 'allowed') return { allowed: false, pending: true, code: 'NETWORK_APPROVAL_REQUIRED', error: '需要用户确认本轮联网查询' };
    }
    if (operationCount >= limit) {
      return { allowed: false, code: 'OPERATION_LIMIT', error: `本轮最多允许 ${limit} 次联网操作，请使用已有资料回答` };
    }
    return { allowed: true, operation, remaining: limit - operationCount };
  }

  function consume(capability, operation = capability) {
    const result = check(capability, operation);
    if (!result.allowed) return result;
    operationCount += 1;
    return { ...result, consumed: true, remaining: limit - operationCount };
  }

  return {
    check,
    consume,
    get usage() { return { used: operationCount, limit, remaining: limit - operationCount }; },
  };
}
