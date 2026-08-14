'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { spaces as spacesApi } from '@/lib/api';

interface CompressionStats {
  originalCount: number;
  originalTokens: number;
  compressedCount: number;
  compressedTokens: number;
  reductionPercentage: number;
  compressionLevel: 'none' | 'light' | 'moderate' | 'aggressive';
  budgetExceeded: boolean;
  lastCompressedAt: string | null;
  compressionHistory: Array<{
    timestamp: string;
    reductionPercentage: number;
    level: string;
    originalTokens: number;
    compressedTokens: number;
  }>;
  messageCount: number;
}

interface UseContextCompressionOptions {
  spaceId?: string;
  autoRefresh?: boolean;
  refreshInterval?: number; // milliseconds
}

export function useContextCompression({
  spaceId,
  autoRefresh = false,
  refreshInterval = 30000,
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
      if (sequence === requestSequence.current) setStats(result);
    } catch (err: any) {
      if (sequence === requestSequence.current) setError(err.message || '获取压缩统计失败');
    } finally {
      if (sequence === requestSequence.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!spaceId) return;
    setStats(null);

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
  }, [spaceId, autoRefresh, refreshInterval, fetchCompressionStats]);

  return {
    stats,
    isLoading,
    error,
    refetch: () => fetchCompressionStats(spaceId),
  };
}
