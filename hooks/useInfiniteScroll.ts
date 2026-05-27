'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface UseInfiniteScrollOptions<T> {
  items: T[];
  pageSize?: number;
}

export function useInfiniteScroll<T>({ items, pageSize = 20 }: UseInfiniteScrollOptions<T>) {
  const [displayCount, setDisplayCount] = useState(pageSize);
  const [loading, setLoading] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const hasMore = displayCount < items.length;
  const displayed = items.slice(0, displayCount);

  const loadMore = useCallback(() => {
    if (!hasMore || loading) return;
    setLoading(true);
    // Simulate small delay for smooth UX
    setTimeout(() => {
      setDisplayCount((prev) => Math.min(prev + pageSize, items.length));
      setLoading(false);
    }, 300);
  }, [hasMore, loading, pageSize, items.length]);

  // Reset when items change (e.g., category filter, search)
  useEffect(() => {
    setDisplayCount(pageSize);
  }, [items, pageSize]);

  // IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          loadMore();
        }
      },
      { rootMargin: '200px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loading, loadMore]);

  return { displayed, hasMore, loading, sentinelRef, total: items.length };
}
