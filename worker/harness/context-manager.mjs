function estimateTokens(text) {
  if (!text) return 0;
  const chineseChars = (String(text).match(/[\u4e00-\u9fff]/g) || []).length;
  const nonChineseChars = String(text).length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + nonChineseChars / 4);
}

function estimateMessageTokens(message) {
  return estimateTokens(message?.content) + 20;
}

function estimateMessagesTokens(messages) {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

function positiveInteger(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export class ContextCompressionManager {
  constructor(options = {}) {
    this.maxTargetTokens = positiveInteger(options.maxTargetTokens, 8000);
    this.hardLimitMessages = positiveInteger(options.hardLimitMessages, 80);
    this.preserveRecentCount = positiveInteger(options.preserveRecentCount, 12);
    this.compressionThreshold = positiveInteger(options.compressionThreshold, 40);
    this.aggressiveThreshold = positiveInteger(options.aggressiveThreshold, 60);
  }

  analyzeMessageImportance(message, currentIndex, messageCount) {
    const recency = messageCount > 0 ? (currentIndex + 1) / messageCount : 1;
    const content = String(message?.content || '');
    let score = recency * 35;
    if (message?.role === 'user') score += 30;
    else if (message?.role === 'assistant') score += 20;
    if (content.length > 30 && content.length < 800) score += 15;
    else if (content.length >= 800) score += 10;
    if (/(重要|关键|核心|注意|记住|要求|目标|必须|不能|禁止|规则|总结|结论|结果|交付)/.test(content)) {
      score += 20;
    }
    if (content.includes('```')) score += 15;
    return score;
  }

  compress(messages, options = {}) {
    const targetTokens = positiveInteger(options.targetTokens, this.maxTargetTokens);
    const maxMessages = positiveInteger(options.maxMessages, this.hardLimitMessages);
    const preserveRecent = Math.min(
      maxMessages,
      positiveInteger(options.preserveRecent, this.preserveRecentCount)
    );
    const originalCount = messages.length;
    const originalTokens = estimateMessagesTokens(messages);

    if (originalCount <= maxMessages && originalTokens <= targetTokens) {
      return {
        compressed: messages,
        stats: {
          originalCount,
          originalTokens,
          compressedCount: originalCount,
          compressedTokens: originalTokens,
          reductionCount: 0,
          reductionTokens: 0,
          reductionPercentage: 0,
          compressionLevel: 'none',
          budgetExceeded: false,
        },
      };
    }

    const systemMessages = messages.filter((message) => message.role === 'system').slice(-maxMessages);
    const regularMessages = messages.filter((message) => message.role !== 'system');
    const regularSlots = Math.max(0, maxMessages - systemMessages.length);
    let recentMessages = regularMessages.slice(-Math.min(preserveRecent, regularSlots));
    while (
      recentMessages.length > 1 &&
      estimateMessagesTokens([...systemMessages, ...recentMessages]) > targetTokens
    ) {
      recentMessages = recentMessages.slice(1);
    }

    const recentIds = new Set(recentMessages.map((message) => message.id));
    const olderMessages = regularMessages.filter((message) => !recentIds.has(message.id));
    const candidates = olderMessages.map((message, index) => ({
      message,
      score: this.analyzeMessageImportance(message, index, olderMessages.length),
      originalIndex: messages.findIndex((candidate) => candidate.id === message.id),
    }));
    candidates.sort((left, right) => right.score - left.score || right.originalIndex - left.originalIndex);

    const selected = [...systemMessages, ...recentMessages];
    let selectedTokens = estimateMessagesTokens(selected);
    for (const candidate of candidates) {
      if (selected.length >= maxMessages) break;
      const candidateTokens = estimateMessageTokens(candidate.message);
      if (selectedTokens + candidateTokens > targetTokens) continue;
      selected.push(candidate.message);
      selectedTokens += candidateTokens;
    }

    const selectedIds = new Set(selected.map((message) => message.id));
    const compressed = messages.filter((message) => selectedIds.has(message.id));
    const compressedTokens = estimateMessagesTokens(compressed);
    const reductionTokens = Math.max(0, originalTokens - compressedTokens);
    const reductionPercentage = originalTokens > 0
      ? Math.round((reductionTokens / originalTokens) * 100)
      : 0;
    const compressionLevel = originalCount === compressed.length && reductionPercentage === 0
      ? 'none'
      : originalCount > this.aggressiveThreshold || reductionPercentage >= 60
        ? 'aggressive'
        : originalCount > this.compressionThreshold || reductionPercentage >= 30
          ? 'moderate'
          : 'light';

    return {
      compressed,
      stats: {
        originalCount,
        originalTokens,
        compressedCount: compressed.length,
        compressedTokens,
        reductionCount: originalCount - compressed.length,
        reductionTokens,
        reductionPercentage,
        compressionLevel,
        budgetExceeded: compressedTokens > targetTokens,
      },
    };
  }
}

export const contextManager = new ContextCompressionManager();
