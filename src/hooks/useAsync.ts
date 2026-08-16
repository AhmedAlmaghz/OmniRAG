'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface UseAsyncResult<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

type AsyncFn<T> = (signal: AbortSignal) => Promise<T>;

/**
 * React hook for managing the lifecycle of an async request attached to a
 * component. Replaces the common `useEffect` + `useState(isLoading)` + manual
 * `try/catch` pattern with abort-on-unmount and deps-driven refetch.
 *
 * The async function receives an {@link AbortSignal} so long-running requests
 * started during a previous render are cancelled cleanly when deps change or
 * the component unmounts, preventing setState-on-unmounted warnings and
 * stale data races.
 */
export function useAsync<T>(asyncFn: AsyncFn<T>, deps: React.DependencyList = []): UseAsyncResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const fnRef = useRef(asyncFn);
  fnRef.current = asyncFn;
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    fnRef
      .current(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [...deps, refreshTick]);

  const refetch = useCallback(() => setRefreshTick((t) => t + 1), []);

  return { data, isLoading, error, refetch };
}
