"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  saveDraftToStorage,
  loadDraftFromStorage,
  clearDraftFromStorage,
  purgeStaleDrafts,
  shouldRestoreDraft,
} from "./offline-cache.mjs";

interface UseSurveyOfflineCacheOptions {
  attemptId?: string;
  onAnswersLoaded?: (answers: Record<string, unknown>) => void;
}

/** `window.localStorage` itself can throw (disabled storage, privacy modes). */
function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function useSurveyOfflineCache({
  attemptId,
  onAnswersLoaded,
}: UseSurveyOfflineCacheOptions) {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [wasOffline, setWasOffline] = useState<boolean>(false);
  const [isRestored, setIsRestored] = useState<boolean>(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  // Epic 5 review P5: keep the latest callback without making it an effect
  // dependency, and restore a draft at most once per attempt.
  const onAnswersLoadedRef = useRef(onAnswersLoaded);
  const restoredForRef = useRef<string | null>(null);

  useEffect(() => {
    onAnswersLoadedRef.current = onAnswersLoaded;
  });

  // Initialize online status and listen to browser network events
  useEffect(() => {
    if (typeof window === "undefined") return;

    function handleOnline() {
      setIsOnline(true);
      setWasOffline(true);
      // Dismiss "Back online" message after 5 seconds
      setTimeout(() => {
        setWasOffline(false);
      }, 5000);
    }

    function handleOffline() {
      setIsOnline(false);
      setWasOffline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Epic 5 review P25: drop drafts older than 2 hours on mount.
  useEffect(() => {
    purgeStaleDrafts(getLocalStorage(), Date.now());
  }, []);

  // Restore the draft once per attempt (on mount or when the attempt changes)
  useEffect(() => {
    if (!shouldRestoreDraft(restoredForRef.current, attemptId)) return;
    const storage = getLocalStorage();
    if (!storage || !attemptId) return;
    restoredForRef.current = attemptId;

    const draft = loadDraftFromStorage(storage, attemptId, Date.now());
    if (draft && Object.keys(draft).length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsRestored(true);
      onAnswersLoadedRef.current?.(draft);
    }
  }, [attemptId]);

  // Save answers with 300ms debounce
  const saveAnswers = useCallback(
    (answers: Record<string, unknown>) => {
      if (!attemptId || typeof window === "undefined") return;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        saveDraftToStorage(getLocalStorage(), attemptId, answers);
      }, 300);
    },
    [attemptId],
  );

  // Clear draft on successful submission
  const clearDraft = useCallback(() => {
    if (!attemptId || typeof window === "undefined") return;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    clearDraftFromStorage(getLocalStorage(), attemptId);
    setIsRestored(false);
  }, [attemptId]);

  return {
    isOnline,
    wasOffline,
    isRestored,
    saveAnswers,
    clearDraft,
  };
}
