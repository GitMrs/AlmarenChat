'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { spaces as spacesApi } from '@/lib/client/api';

export interface CompressionStats {
  totalTokens?: number;
  activeTokens?: number;
  thresholdTokens?: number;
  savedTokens?: number;
  modelContextWindow?: number;
  totalBytes?: number;
  activeBytes?: number;
  thresholdBytes?: number;
  savedBytes?: number;
  usagePercentage?: number;
  isCompressed?: boolean;
  totalMessages?: number;
  activeMessages?: number;
  archivedMessages?: number;
  formattedTotal?: string;
  formattedActive?: string;
  formattedThreshold?: string;
  formattedSaved?: string;

  // Compatibility fields
  originalCount: number;
  originalTokens?: number;
  compressedCount: number;
  compressedTokens?: number;
  reductionPercentage: number;
  compressionLevel: 'none' | 'light' | 'moderate' | 'aggressive';
  budgetExceeded?: boolean;
  lastCompressedAt: string | null;
  compressionHistory?: Array<{
    timestamp: string;
    reductionPercentage: number;
    level: string;
    originalTokens?: number;
    compressedTokens?: number;
  }>;
  messageCount: number;
  checkpoint: {
    updatedAt: string;
    sourceMessageCount: number;
    sourceTokenCount?: number;
    sourceBytes?: number;
    throughMessageId: string;
  } | null;
}

export interface UseContextCompressionOptions {
  spaceId?: string;
  enabled?: boolean;
  autoRefresh?: boolean;
  refreshInterval?: number; // milliseconds
  refreshKey?: string | number;
}

export function useContextCompression({
  spaceId,
  enabled = true,
  autoRefresh = false,
  refreshInterval = 30000,
  refreshKey,
}: UseContextCompressionOptions = {}) {
  const [stats, setStats] = useState<CompressionStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const fetchCompressionStats = useCallback(async (currentSpaceId?: string) => {
    if (!currentSpaceId) return;
    const sequence = ++requestSequence.current;

    setIsLoading(true);
    setError(null);

    try {
      const result = await spacesApi.getCompressionStats(currentSpaceId);
      if (sequence === requestSequence.current) setStats(result as CompressionStats);
    } catch (err: any) {
      if (sequence === requestSequence.current) setError(err.message || '获取压缩统计失败');
    } finally {
      if (sequence === requestSequence.current) setIsLoading(false);
    }
  }, []);

  const prevSpaceIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!spaceId || !enabled) {
      setStats(null);
      setIsLoading(false);
      prevSpaceIdRef.current = undefined;
      return;
    }

    // Only clear stats when switching to a different spaceId.
    // Retain previous stats during refreshKey updates to prevent compact panel height collapse and sidebar layout shift.
    if (prevSpaceIdRef.current !== spaceId) {
      prevSpaceIdRef.current = spaceId;
      setStats(null);
    }

    fetchCompressionStats(spaceId);

    const interval = autoRefresh
      ? setInterval(() => {
        fetchCompressionStats(spaceId);
      }, refreshInterval)
      : null;
    return () => {
      if (interval) clearInterval(interval);
      requestSequence.current += 1;
    };
  }, [spaceId, enabled, autoRefresh, refreshInterval, refreshKey, fetchCompressionStats]);

  return {
    stats,
    isLoading,
    error,
    refetch: () => fetchCompressionStats(spaceId),
  };
}
