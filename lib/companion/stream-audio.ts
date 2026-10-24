'use client';

export interface StreamAudioCallbacks {
  onPlaying?: () => void;
  onError?: (error: unknown) => void;
  onEnded?: () => void;
}

/**
 * Feed a chunked MP3 response into an audio element through MediaSource.
 * Resolves after the first chunk starts playing; the remaining chunks keep
 * arriving in the background.
 */
export async function playChunkedMp3(
  audio: HTMLAudioElement,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  callbacks: StreamAudioCallbacks = {},
): Promise<() => void> {
  if (typeof window === 'undefined' || !('MediaSource' in window)) {
    throw new Error('当前浏览器不支持流式音频播放');
  }
  if (!MediaSource.isTypeSupported('audio/mpeg')) {
    throw new Error('当前浏览器不支持 MP3 MediaSource');
  }

  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  audio.src = objectUrl;
  const reader = body.getReader();
  let sourceBuffer: SourceBuffer | null = null;
  let stopped = false;
  let firstChunkPlayed = false;
  const queue: Uint8Array[] = [];
  let appendWaiter: (() => void) | null = null;
  const handleEnded = () => callbacks.onEnded?.();

  const cleanup = () => {
    stopped = true;
    reader.cancel().catch(() => {});
    if (sourceBuffer) sourceBuffer.removeEventListener('updateend', flush);
    audio.removeEventListener('ended', handleEnded);
    URL.revokeObjectURL(objectUrl);
  };

  const flush = () => {
    if (stopped || !sourceBuffer || sourceBuffer.updating || queue.length === 0) return;
    const chunk = queue.shift();
    if (!chunk) return;
    try {
      sourceBuffer.appendBuffer(chunk);
    } catch (error) {
      callbacks.onError?.(error);
      cleanup();
    }
  };

  await new Promise<void>((resolve, reject) => {
    const open = () => {
      mediaSource.removeEventListener('sourceopen', open);
      if (stopped) return reject(new Error('流式音频已停止'));
      try {
        sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
        sourceBuffer.addEventListener('updateend', () => {
          flush();
          appendWaiter?.();
          appendWaiter = null;
        });
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    mediaSource.addEventListener('sourceopen', open, { once: true });
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });

  audio.addEventListener('ended', handleEnded, { once: true });

  const pump = async () => {
    try {
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.byteLength) {
          queue.push(value);
          flush();
          if (!firstChunkPlayed) {
            await new Promise<void>((resolve) => {
              const waitForData = () => {
                if (sourceBuffer && !sourceBuffer.updating && queue.length === 0) resolve();
                else appendWaiter = waitForData;
              };
              waitForData();
            });
            if (!stopped) {
              await audio.play();
              firstChunkPlayed = true;
              callbacks.onPlaying?.();
            }
          }
        }
      }
      while (!stopped && (queue.length > 0 || sourceBuffer?.updating)) {
        flush();
        if (queue.length > 0 || sourceBuffer?.updating) {
          await new Promise<void>((resolve) => { appendWaiter = resolve; });
        }
      }
      if (!stopped && mediaSource.readyState === 'open') mediaSource.endOfStream();
    } catch (error) {
      if (!stopped && (error as DOMException)?.name !== 'AbortError') callbacks.onError?.(error);
    }
  };

  void pump();
  return cleanup;
}
