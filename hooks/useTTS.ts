'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { tts } from '@/lib/api';
import { cleanMarkdownForTTS } from '@/lib/tts/markdown-cleaner';

export interface PlayTTSOptions {
  id?: string;
  voice?: string;
  rate?: string;
  pitch?: string;
  cacheNamespace?: 'gomoku';
  onEnded?: () => void;
  onError?: (error: Error) => void;
}

// Client-side in-memory cache for audio Blobs (avoids redundant network requests for previously played lines)
const clientBlobCache = new Map<string, Blob>();
const MAX_CLIENT_CACHE = 100;

function getClientCacheKey(cleanText: string, options: PlayTTSOptions = {}) {
  return `${options.voice || ''}:${options.rate || ''}:${options.pitch || ''}:${options.cacheNamespace || ''}:${cleanText.trim()}`;
}

export function useTTS() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const currentIdRef = useRef<string | null>(null);
  const playSessionIdRef = useRef<number>(0);
  const onEndedCallbackRef = useRef<(() => void) | null>(null);

  const cleanupAudio = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
      audioRef.current = null;
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    currentIdRef.current = null;
    setIsPlaying(false);
    setIsLoading(false);
    setCurrentId(null);
  }, []);

  const stop = useCallback(() => {
    playSessionIdRef.current += 1;
    onEndedCallbackRef.current = null;
    cleanupAudio();
  }, [cleanupAudio]);

  const play = useCallback(
    async (text: string, options: PlayTTSOptions = {}) => {
      const cleanText = cleanMarkdownForTTS(text);
      if (!cleanText) {
        options.onEnded?.();
        return;
      }

      const trackId = options.id || cleanText.slice(0, 32);

      // If already playing this item, toggle stop
      if (currentIdRef.current === trackId && isPlaying) {
        stop();
        return;
      }

      cleanupAudio();
      const sessionId = ++playSessionIdRef.current;
      onEndedCallbackRef.current = options.onEnded || null;

      const clientCacheKey = getClientCacheKey(cleanText, options);
      const cachedBlob = clientBlobCache.get(clientCacheKey);

      // Only show loading spinner if we need to fetch over network
      if (!cachedBlob) {
        setIsLoading(true);
      }
      setError(null);
      currentIdRef.current = trackId;
      setCurrentId(trackId);

      try {
        const blob = cachedBlob || (await tts.synthesizeBlob(cleanText, {
          voice: options.voice,
          rate: options.rate,
          pitch: options.pitch,
          cacheNamespace: options.cacheNamespace,
        }));

        if (!cachedBlob && blob) {
          if (clientBlobCache.size >= MAX_CLIENT_CACHE) {
            const oldestKey = clientBlobCache.keys().next().value;
            if (oldestKey) clientBlobCache.delete(oldestKey);
          }
          clientBlobCache.set(clientCacheKey, blob);
        }

        // Check if stopped or switched while fetching
        if (playSessionIdRef.current !== sessionId) {
          return;
        }

        const objectUrl = URL.createObjectURL(blob);
        objectUrlRef.current = objectUrl;

        const audio = new Audio(objectUrl);
        audioRef.current = audio;

        audio.onplay = () => {
          if (playSessionIdRef.current === sessionId) {
            setIsPlaying(true);
            setIsLoading(false);
          }
        };

        const notifyDone = () => {
          if (playSessionIdRef.current === sessionId) {
            const cb = onEndedCallbackRef.current;
            onEndedCallbackRef.current = null;
            cleanupAudio();
            cb?.();
          }
        };

        audio.onended = () => {
          notifyDone();
        };

        audio.onerror = () => {
          if (playSessionIdRef.current === sessionId) {
            const cb = onEndedCallbackRef.current;
            onEndedCallbackRef.current = null;
            cleanupAudio();
            setError('音频播放失败');
            options.onError?.(new Error('音频播放失败'));
            cb?.();
          }
        };

        await audio.play();
      } catch (err: any) {
        if (playSessionIdRef.current === sessionId) {
          const cb = onEndedCallbackRef.current;
          onEndedCallbackRef.current = null;
          cleanupAudio();
          setError(err.message || '语音合成失败');
          options.onError?.(err);
          cb?.();
        }
      }
    },
    [cleanupAudio, isPlaying, stop]
  );

  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, [cleanupAudio]);

  return {
    play,
    stop,
    isPlaying,
    isLoading,
    isBusy: isPlaying || isLoading,
    currentId,
    error,
  };
}
