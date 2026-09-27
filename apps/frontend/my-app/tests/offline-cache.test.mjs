import assert from "node:assert/strict";
import test from "node:test";
import {
  getStorageKey,
  saveDraftToStorage,
  loadDraftFromStorage,
  clearDraftFromStorage,
  isDraftStale,
  purgeStaleDrafts,
  shouldRestoreDraft,
  DRAFT_MAX_AGE_MS,
} from "../app/forms/hooks/offline-cache.mjs";

function createMockStorage() {
  const store = new Map();
  return {
    get length() {
      return store.size;
    },
    key(index) {
      return [...store.keys()][index] ?? null;
    },
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

test("generates expected localStorage draft key for attempt", () => {
  assert.equal(getStorageKey("att-123"), "rescom_survey_draft_att-123");
});

test("saves and loads draft answers successfully", () => {
  const storage = createMockStorage();
  const attemptId = "att-123";
  const answers = { q1: "test answer", q2: 42, q3: ["option-a"] };

  const saved = saveDraftToStorage(storage, attemptId, answers);
  assert.equal(saved, true);

  const loaded = loadDraftFromStorage(storage, attemptId);
  assert.deepEqual(loaded, answers);
});

test("returns null if no draft exists in storage", () => {
  const storage = createMockStorage();
  const loaded = loadDraftFromStorage(storage, "non-existent");
  assert.equal(loaded, null);
});

test("safely handles corrupted JSON in storage", () => {
  const storage = createMockStorage();
  storage.setItem(getStorageKey("att-corrupt"), "{ not json ");

  const loaded = loadDraftFromStorage(storage, "att-corrupt");
  assert.equal(loaded, null);
});

test("clears draft from storage successfully", () => {
  const storage = createMockStorage();
  const attemptId = "att-clear";
  saveDraftToStorage(storage, attemptId, { q1: "done" });

  assert.notEqual(loadDraftFromStorage(storage, attemptId), null);
  clearDraftFromStorage(storage, attemptId);
  assert.equal(loadDraftFromStorage(storage, attemptId), null);
});

// Epic 5 review P5: restore the draft once per attempt, never per render.
test("restores a draft only once per attempt id", () => {
  assert.equal(shouldRestoreDraft(null, "att-1"), true);
  assert.equal(shouldRestoreDraft("att-1", "att-1"), false);
  assert.equal(shouldRestoreDraft("att-1", "att-2"), true);
  assert.equal(shouldRestoreDraft(null, undefined), false);
  assert.equal(shouldRestoreDraft(null, ""), false);
});

test("simulated re-renders with a draft present restore exactly once", () => {
  const storage = createMockStorage();
  saveDraftToStorage(storage, "att-loop", { q1: "draft" });
  let restoredFor = null;
  let restoreCount = 0;
  for (let render = 0; render < 50; render++) {
    if (!shouldRestoreDraft(restoredFor, "att-loop")) continue;
    restoredFor = "att-loop";
    if (loadDraftFromStorage(storage, "att-loop")) restoreCount++;
  }
  assert.equal(restoreCount, 1);
});

// Epic 5 review P25: stale drafts are ignored and purged.
test("treats drafts older than 2 hours or without savedAt as stale", () => {
  const now = Date.parse("2026-09-26T12:00:00.000Z");
  assert.equal(isDraftStale(new Date(now - 60_000).toISOString(), now), false);
  assert.equal(isDraftStale(new Date(now - DRAFT_MAX_AGE_MS).toISOString(), now), false);
  assert.equal(isDraftStale(new Date(now - DRAFT_MAX_AGE_MS - 1).toISOString(), now), true);
  assert.equal(isDraftStale(undefined, now), true);
  assert.equal(isDraftStale("not-a-date", now), true);
});

test("loading a stale draft returns null and removes it", () => {
  const storage = createMockStorage();
  const now = Date.parse("2026-09-26T12:00:00.000Z");
  saveDraftToStorage(storage, "att-old", { q1: "old" }, now - DRAFT_MAX_AGE_MS - 1000);

  assert.equal(loadDraftFromStorage(storage, "att-old", now), null);
  assert.equal(storage.getItem(getStorageKey("att-old")), null);
});

test("loading a fresh draft keeps it in storage", () => {
  const storage = createMockStorage();
  const now = Date.parse("2026-09-26T12:00:00.000Z");
  saveDraftToStorage(storage, "att-fresh", { q1: "fresh" }, now - 5 * 60_000);

  assert.deepEqual(loadDraftFromStorage(storage, "att-fresh", now), { q1: "fresh" });
  assert.notEqual(storage.getItem(getStorageKey("att-fresh")), null);
});

test("purgeStaleDrafts removes only stale or corrupt survey drafts", () => {
  const storage = createMockStorage();
  const now = Date.parse("2026-09-26T12:00:00.000Z");
  saveDraftToStorage(storage, "att-stale", { q1: "a" }, now - DRAFT_MAX_AGE_MS - 1);
  saveDraftToStorage(storage, "att-recent", { q1: "b" }, now - 1000);
  storage.setItem(getStorageKey("att-corrupt"), "{ not json ");
  storage.setItem("unrelated_key", JSON.stringify({ savedAt: "1999-01-01T00:00:00.000Z" }));

  assert.equal(purgeStaleDrafts(storage, now), 2);
  assert.equal(storage.getItem(getStorageKey("att-stale")), null);
  assert.equal(storage.getItem(getStorageKey("att-corrupt")), null);
  assert.notEqual(storage.getItem(getStorageKey("att-recent")), null);
  assert.notEqual(storage.getItem("unrelated_key"), null);
});

test("storage helpers never throw when storage access fails", () => {
  const throwingStorage = {
    get length() {
      throw new Error("SecurityError");
    },
    key() {
      throw new Error("SecurityError");
    },
    getItem() {
      throw new Error("SecurityError");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
    removeItem() {
      throw new Error("SecurityError");
    },
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(purgeStaleDrafts(throwingStorage, Date.now()), 0);
    assert.equal(purgeStaleDrafts(null, Date.now()), 0);
    assert.equal(loadDraftFromStorage(throwingStorage, "att-x"), null);
    assert.equal(saveDraftToStorage(throwingStorage, "att-x", { q1: 1 }), false);
    assert.doesNotThrow(() => clearDraftFromStorage(throwingStorage, "att-x"));
  } finally {
    console.warn = originalWarn;
  }
});
