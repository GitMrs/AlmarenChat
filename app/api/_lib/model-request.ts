import prisma from '@/app/api/_lib/db';
import { resolveAgent } from '@/app/api/_lib/spaces';
import { loadAgentModelSetting, resolveUserModelConfig } from '@/app/api/_lib/agent-model';

/** 模型列表、连接测试与实际对话使用相同的继承规则。 */
export async function resolveModelRequestConfig(userId: string, body: any) {
  if (body?.agentId !== undefined && (typeof body.agentId !== 'string' || !await resolveAgent(body.agentId, userId))) {
    throw Object.assign(new Error('Agent not found'), { status: 404 });
  }
  const [user, agentSetting] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { customModelEnabled: true, modelName: true, apiBaseUrl: true, apiKey: true } }),
    body?.agentId && body.inheritAgentModel === true ? loadAgentModelSetting(userId, body.agentId) : null,
  ]);
  const overrides = Object.fromEntries(['apiBaseUrl', 'apiKey', 'modelName'].map(field => [field, typeof body?.[field] === 'string' ? body[field].trim() : null]));
  return resolveUserModelConfig(body?.agentId ? user : { ...user, customModelEnabled: true }, agentSetting, overrides);
}
