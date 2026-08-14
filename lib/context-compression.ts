/**
 * Deterministic context selection for space conversations.
 *
 * Messages are kept whole. Older messages may be omitted, but message content is
 * never rewritten or presented as if it were the original text.
 */

import type { Agent } from '@/types';

export interface CompressionMessage {
  id: string;
  role: string;
  content: string;
  speakerAgentId?: string | null;
}

export interface CompressionConfig {
  maxMessages: number;
  targetTokens: number;
  aggressiveAfter: number;
  preserveRecent: number;
  preserveSystem: boolean;
}

export interface CompressionStats {
  originalCount: number;
  originalTokens: number;
  compressedCount: number;
  compressedTokens: number;
  reductionCount: number;
  reductionTokens: number;
  reductionPercentage: number;
  compressionLevel: 'none' | 'light' | 'moderate' | 'aggressive';
  budgetExceeded: boolean;
}

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  maxMessages: 60,
  targetTokens: 8000,
  aggressiveAfter: 40,
  preserveRecent: 10,
  preserveSystem: true,
};

interface MessageScore {
  messageId: string;
  score: number;
  reasons: string[];
}

export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const nonChineseChars = text.length - chineseChars;
  return Math.ceil(chineseChars / 1.5 + nonChineseChars / 4);
}

function estimateMessageTokens(message: Pick<CompressionMessage, 'content'>): number {
  return estimateTokens(message.content) + 20;
}

export function estimateMessagesTokens(messages: Pick<CompressionMessage, 'content'>[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

export function analyzeMessageImportance(
  message: CompressionMessage,
  context: {
    allMessages: CompressionMessage[];
    agents: ReadonlyMap<string, Pick<Agent, 'id'>>;
    currentIndex: number;
  }
): MessageScore {
  const { allMessages, agents, currentIndex } = context;
  const score: MessageScore = { messageId: message.id, score: 0, reasons: [] };
  const recency = allMessages.length > 0 ? (currentIndex + 1) / allMessages.length : 1;

  score.score += recency * 30;
  if (recency >= 0.7) score.reasons.push('最近消息');

  const content = message.content || '';
  if (content.length > 20 && content.length < 500) score.score += 10;
  else if (content.length >= 500) score.score += 15;

  if (message.role === 'user') score.score += 25;
  else if (message.role === 'assistant') score.score += 15;
  else if (message.role === 'system') score.score += 50;

  const importantKeywords = [
    '重要', '关键', '核心', '注意', '记住', '要求', '目标', '必须', '应该',
    '不能', '禁止', '规则', '原则', '总结', '结论', '最终',
  ];
  if (importantKeywords.some((keyword) => content.toLowerCase().includes(keyword))) {
    score.score += 15;
    score.reasons.push('包含关键词');
  }
  if (content.includes('```')) score.score += 20;
  if (/(?:^|\n)(?:[-*] |\d+\. )/.test(content)) score.score += 10;

  const speaker = message.speakerAgentId ? agents.get(message.speakerAgentId) : null;
  const previousSpeaker = currentIndex > 0 ? allMessages[currentIndex - 1]?.speakerAgentId : null;
  if (speaker && previousSpeaker && previousSpeaker !== message.speakerAgentId) score.score += 8;

  return score;
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function compressionLevel(
  originalCount: number,
  compressedCount: number,
  reductionPercentage: number,
  aggressiveAfter: number
): CompressionStats['compressionLevel'] {
  if (originalCount === compressedCount && reductionPercentage <= 0) return 'none';
  if (originalCount > aggressiveAfter || reductionPercentage >= 60) return 'aggressive';
  if (reductionPercentage >= 30) return 'moderate';
  return 'light';
}

export function compressConversationContext<T extends CompressionMessage>(
  messages: T[],
  config: Partial<CompressionConfig> = {},
  agents: ReadonlyMap<string, Pick<Agent, 'id'>> = new Map()
): { compressedMessages: T[]; stats: CompressionStats } {
  const merged = { ...DEFAULT_COMPRESSION_CONFIG, ...config };
  const maxMessages = positiveInteger(merged.maxMessages, DEFAULT_COMPRESSION_CONFIG.maxMessages);
  const targetTokens = positiveInteger(merged.targetTokens, DEFAULT_COMPRESSION_CONFIG.targetTokens);
  const preserveRecent = Math.min(
    maxMessages,
    positiveInteger(merged.preserveRecent, DEFAULT_COMPRESSION_CONFIG.preserveRecent)
  );
  const aggressiveAfter = positiveInteger(merged.aggressiveAfter, DEFAULT_COMPRESSION_CONFIG.aggressiveAfter);
  const originalCount = messages.length;
  const originalTokens = estimateMessagesTokens(messages);

  if (originalCount <= maxMessages && originalTokens <= targetTokens) {
    return {
      compressedMessages: messages,
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

  const systemMessages = merged.preserveSystem
    ? messages.filter((message) => message.role === 'system').slice(-maxMessages)
    : [];
  const regularMessages = messages.filter((message) => message.role !== 'system');
  const availableRegularSlots = Math.max(0, maxMessages - systemMessages.length);
  let recentMessages = regularMessages.slice(-Math.min(preserveRecent, availableRegularSlots));

  // Prefer complete recent messages, but discard the oldest of them when the
  // budget cannot hold the requested recent window. The newest message remains.
  while (
    recentMessages.length > 1 &&
    estimateMessagesTokens([...systemMessages, ...recentMessages]) > targetTokens
  ) {
    recentMessages = recentMessages.slice(1);
  }

  const recentIds = new Set(recentMessages.map((message) => message.id));
  const olderMessages = regularMessages.filter((message) => !recentIds.has(message.id));
  const scored = olderMessages.map((message, currentIndex) => ({
    message,
    originalIndex: messages.findIndex((candidate) => candidate.id === message.id),
    score: analyzeMessageImportance(message, { allMessages: olderMessages, agents, currentIndex }).score,
  }));
  scored.sort((left, right) => right.score - left.score || right.originalIndex - left.originalIndex);

  const selected = [...systemMessages, ...recentMessages];
  let selectedTokens = estimateMessagesTokens(selected);
  for (const candidate of scored) {
    if (selected.length >= maxMessages) break;
    const candidateTokens = estimateMessageTokens(candidate.message);
    if (selectedTokens + candidateTokens > targetTokens) continue;
    selected.push(candidate.message);
    selectedTokens += candidateTokens;
  }

  const selectedIds = new Set(selected.map((message) => message.id));
  const compressedMessages = messages.filter((message) => selectedIds.has(message.id));
  const compressedTokens = estimateMessagesTokens(compressedMessages);
  const reductionTokens = Math.max(0, originalTokens - compressedTokens);
  const reductionPercentage = originalTokens > 0
    ? Math.round((reductionTokens / originalTokens) * 100)
    : 0;

  return {
    compressedMessages,
    stats: {
      originalCount,
      originalTokens,
      compressedCount: compressedMessages.length,
      compressedTokens,
      reductionCount: originalCount - compressedMessages.length,
      reductionTokens,
      reductionPercentage,
      compressionLevel: compressionLevel(
        originalCount,
        compressedMessages.length,
        reductionPercentage,
        aggressiveAfter
      ),
      budgetExceeded: compressedTokens > targetTokens,
    },
  };
}

export function generateCompressionSummary(stats: CompressionStats): string {
  const levelText = {
    none: '无需压缩',
    light: '轻度压缩',
    moderate: '中度压缩',
    aggressive: '激进压缩',
  }[stats.compressionLevel];
  return [
    '上下文压缩摘要：',
    `- 压缩级别：${levelText}`,
    `- 消息数量：${stats.originalCount} -> ${stats.compressedCount}（减少 ${stats.reductionCount} 条）`,
    `- Token 估算：${stats.originalTokens} -> ${stats.compressedTokens}（减少 ${stats.reductionPercentage}%）`,
  ].join('\n');
}

export function smartTruncate<T extends CompressionMessage>(
  messages: T[],
  maxLength: number,
  agents: ReadonlyMap<string, Pick<Agent, 'id'>> = new Map()
): T[] {
  return compressConversationContext(messages, {
    maxMessages: maxLength,
    preserveRecent: Math.max(1, Math.floor(maxLength * 0.6)),
  }, agents).compressedMessages;
}
