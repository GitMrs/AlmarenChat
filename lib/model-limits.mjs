export const MODEL_CONTEXT_WINDOW_OPTIONS = [32_768, 65_536, 131_072, 200_000, 262_144, 1_048_576];

export function recommendedModelContextWindow() {
  return 131_072;
}

export function normalizeModelContextWindow(value) {
  const numeric = Number(value);
  return MODEL_CONTEXT_WINDOW_OPTIONS.includes(numeric)
    ? numeric
    : recommendedModelContextWindow();
}

export function modelTokenLimits(_modelName, configuredContextWindow) {
  const contextWindow = normalizeModelContextWindow(configuredContextWindow);
  const maxTokens = Math.min(32_768, Math.max(4_096, Math.floor(contextWindow / 4)));
  const reserveTokens = Math.max(
    Math.floor(contextWindow * 0.15),
    maxTokens + Math.min(16_000, Math.floor(contextWindow * 0.05))
  );
  const compactionTriggerTokens = Math.floor((contextWindow - reserveTokens) / 1_000) * 1_000;
  const keepRecentTokens = Math.min(
    64_000,
    Math.max(8_000, Math.floor(compactionTriggerTokens * 0.2 / 1_000) * 1_000)
  );
  return { contextWindow, maxTokens, compactionTriggerTokens, keepRecentTokens };
}

export function conversationContextTargetTokens(modelName, configuredContextWindow) {
  const limits = modelTokenLimits(modelName, configuredContextWindow);
  return Math.min(limits.compactionTriggerTokens, Math.max(8_000, Math.floor(limits.contextWindow * 0.25)));
}

export function taskContextTargetTokens(modelName, configuredContextWindow) {
  const limits = modelTokenLimits(modelName, configuredContextWindow);
  return Math.min(32_000, Math.max(3_000, Math.floor(limits.contextWindow * 0.08)));
}
