import React, { useEffect, useRef, useState } from "react";
import { useObjectUrlFromBase64 } from "./media-blob";

interface UseInlineMediaResult {
  url: string | null;
  isLoading: boolean;
  error: string | null;
  ref: React.RefObject<HTMLDivElement | null>;
}

const mediaCache = new Map<
  string,
  { base64: string; mimeType: string; timestamp: number }
>();
const CACHE_MAX_AGE = 5 * 60 * 1000;

function getCacheKey(threadId: string, filePath: string): string {
  return `${threadId}:${filePath}`;
}

function pruneCache(): void {
  const now = Date.now();
  for (const [key, entry] of mediaCache) {
    if (now - entry.timestamp > CACHE_MAX_AGE) {
      mediaCache.delete(key);
    }
  }
}

export function useInlineMedia(
  threadId: string,
  filePath: string,
  mimeType: string,
  options?: { lazy?: boolean },
): UseInlineMediaResult {
  const lazy = options?.lazy ?? false;
  const [isVisible, setIsVisible] = useState(!lazy);
  const [base64, setBase64] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // IntersectionObserver for lazy loading
  useEffect(() => {
    if (!lazy || !ref.current) return;
    const el = ref.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [lazy]);

  // Load file when visible
  useEffect(() => {
    if (!isVisible) return;

    const cacheKey = getCacheKey(threadId, filePath);
    const cached = mediaCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_MAX_AGE) {
      setBase64(cached.base64);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    window.api.workspace
      .readBinaryFile(threadId, filePath)
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.content) {
          pruneCache();
          mediaCache.set(cacheKey, {
            base64: result.content,
            mimeType,
            timestamp: Date.now(),
          });
          setBase64(result.content);
        } else {
          setError(result.error || "无法读取文件");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isVisible, threadId, filePath, mimeType]);

  const url = useObjectUrlFromBase64(base64, mimeType);

  return { url, isLoading, error, ref };
}
