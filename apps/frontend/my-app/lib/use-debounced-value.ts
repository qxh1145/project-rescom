"use client";

import { useEffect, useState } from "react";

/**
 * Returns `value` once it has stopped changing for `delayMs` (e.g. a search
 * box, so the feed is not re-queried on every keystroke).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
