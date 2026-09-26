export const DRAFT_KEY_PREFIX = "rescom_survey_draft_";

/** Offline drafts older than this are ignored and removed (Epic 5 review P25). */
export const DRAFT_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function getStorageKey(attemptId) {
  return `${DRAFT_KEY_PREFIX}${attemptId}`;
}

/**
 * A draft is stale when its `savedAt` is missing, unparseable or older than
 * `maxAgeMs`. A `savedAt` in the future (clock skew) is not treated as stale.
 */
export function isDraftStale(savedAt, now = Date.now(), maxAgeMs = DRAFT_MAX_AGE_MS) {
  if (typeof savedAt !== "string") return true;
  const savedAtMs = Date.parse(savedAt);
  if (!Number.isFinite(savedAtMs)) return true;
  return now - savedAtMs > maxAgeMs;
}

/**
 * Epic 5 review P5: the restore effect must run once per attempt, not on every
 * render. Returns true when a draft for `attemptId` has not been restored yet.
 */
export function shouldRestoreDraft(restoredForAttemptId, attemptId) {
  return Boolean(attemptId) && restoredForAttemptId !== attemptId;
}

export function saveDraftToStorage(storage, attemptId, answers, now = Date.now()) {
  if (!storage || !attemptId) return false;
  try {
    const key = getStorageKey(attemptId);
    const data = {
      answers,
      savedAt: new Date(now).toISOString(),
    };
    storage.setItem(key, JSON.stringify(data));
    return true;
  } catch (err) {
    console.warn("Failed to persist survey answers to local storage", err);
    return false;
  }
}

function removeKeyQuietly(storage, key) {
  try {
    storage.removeItem(key);
  } catch {
    // Ignore storage errors (private mode, quota, disabled storage)
  }
}

export function loadDraftFromStorage(storage, attemptId, now = Date.now()) {
  if (!storage || !attemptId) return null;
  const key = getStorageKey(attemptId);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "answers" in parsed) {
      if (isDraftStale(parsed.savedAt, now)) {
        removeKeyQuietly(storage, key);
        return null;
      }
      return parsed.answers;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearDraftFromStorage(storage, attemptId) {
  if (!storage || !attemptId) return;
  removeKeyQuietly(storage, getStorageKey(attemptId));
}

/**
 * Removes every stale or corrupt `rescom_survey_draft_*` entry. Returns the
 * number of removed drafts; never throws.
 */
export function purgeStaleDrafts(storage, now = Date.now(), maxAgeMs = DRAFT_MAX_AGE_MS) {
  if (!storage) return 0;
  const staleKeys = [];
  try {
    const length = Number(storage.length) || 0;
    for (let index = 0; index < length; index++) {
      const key = storage.key(index);
      if (typeof key !== "string" || !key.startsWith(DRAFT_KEY_PREFIX)) continue;
      let savedAt;
      try {
        savedAt = JSON.parse(storage.getItem(key) ?? "null")?.savedAt;
      } catch {
        savedAt = undefined;
      }
      if (isDraftStale(savedAt, now, maxAgeMs)) staleKeys.push(key);
    }
  } catch {
    return 0;
  }
  for (const key of staleKeys) removeKeyQuietly(storage, key);
  return staleKeys.length;
}
