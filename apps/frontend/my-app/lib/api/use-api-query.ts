"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api-error.ts";

export interface ApiQueryState<T> {
  data: T | undefined;
  error: ApiError | null;
  loading: boolean;
  /** Re-runs the fetcher; keeps the previous data visible while loading. */
  reload: () => void;
  /** Local optimistic update without refetching. */
  setData: (updater: (current: T | undefined) => T | undefined) => void;
}

export interface Settled<T> {
  requestId: string;
  data: T | undefined;
  error: ApiError | null;
}

/** `"<key>#"` — every request id of one key starts with it (versions follow the last `#`). */
function keyPrefixOf(requestId: string): string {
  return requestId.slice(0, requestId.lastIndexOf("#") + 1);
}

/** Settled state after a failure: data survives only a failed reload of the same key. */
export function settleWithError<T>(previous: Settled<T>, requestId: string, error: ApiError): Settled<T> {
  const sameKey = previous.requestId !== "" && keyPrefixOf(previous.requestId) === keyPrefixOf(requestId);
  return { requestId, data: sameKey ? previous.data : undefined, error };
}

/** What the hook exposes: nothing for `key: null`, nothing from another key, no error while loading. */
export function queryView<T>(
  key: string | null,
  requestId: string,
  settled: Settled<T>,
): { data: T | undefined; error: ApiError | null; loading: boolean } {
  if (key === null) return { data: undefined, error: null, loading: false };
  const loading = settled.requestId !== requestId;
  // Reloads keep the previous data; a different key starts empty.
  const sameKey = keyPrefixOf(settled.requestId) === `${key}#`;
  return {
    data: sameKey ? settled.data : undefined,
    error: sameKey && !loading ? settled.error : null,
    loading,
  };
}

function toApiError(cause: unknown): ApiError {
  if (cause instanceof ApiError) return cause;
  return new ApiError({ kind: "network", message: "Unexpected error", cause });
}

/**
 * Minimal client-side fetch hook for service functions in `lib/<domain>`.
 * `fetcher` receives an AbortSignal; pass a stable `key` (e.g. the id) — the
 * query re-runs when it changes. `key: null` skips the request.
 */
export function useApiQuery<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
): ApiQueryState<T> {
  const [version, setVersion] = useState(0);
  const [settled, setSettled] = useState<Settled<T>>({ requestId: "", data: undefined, error: null });
  const fetcherRef = useRef(fetcher);
  const requestId = key === null ? "" : `${key}#${version}`;

  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (!requestId) return;
    const controller = new AbortController();
    fetcherRef
      .current(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setSettled({ requestId, data, error: null });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setSettled((previous) => settleWithError(previous, requestId, toApiError(cause)));
        }
      });
    return () => controller.abort();
  }, [requestId]);

  const reload = useCallback(() => setVersion((current) => current + 1), []);
  const setData = useCallback(
    (updater: (current: T | undefined) => T | undefined) =>
      setSettled((previous) => ({ ...previous, data: updater(previous.data) })),
    [],
  );

  return { ...queryView(key, requestId, settled), reload, setData };
}
