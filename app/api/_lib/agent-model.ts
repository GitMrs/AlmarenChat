import prisma from '@/app/api/_lib/db';
import { DEFAULT_BASE_URL, DEFAULT_MODEL } from '@/lib/model-client';
import { resolveAgentModelConfig } from '@/lib/agent-model-config.mjs';

type ModelFields = { modelName?: string | null; apiBaseUrl?: string | null; apiKey?: string | null };

export function loadAgentModelSetting(userId: string, agentId?: string | null) {
  return agentId
    ? prisma.agentModelSetting.findUnique({ where: { userId_agentId: { userId, agentId } } })
    : Promise.resolve(null);
}

export function resolveUserModelConfig(user: (ModelFields & { customModelEnabled?: boolean }) | null, agentSetting?: ModelFields | null, member?: ModelFields | null) {
  return resolveAgentModelConfig({
    user, agentSetting, member,
    defaults: {
      apiBaseUrl: process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
      apiKey: process.env.apiKey || process.env.OPENAI_API_KEY || null,
      modelName: DEFAULT_MODEL,
    },
  });
}
