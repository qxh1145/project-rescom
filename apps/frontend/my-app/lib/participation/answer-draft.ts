/**
 * Local draft of an in-Rescom attempt (Figma 4 "Lưu và thoát", 4b "Đã lưu
 * trên máy lúc 14:31"). The backend has no draft route, so answers live in
 * localStorage per attempt until the submit succeeds. Storage may be missing
 * or throw (private mode): every helper then degrades to a no-op.
 *
 * Privacy: a draft older than the reservation window (`RESERVATION_EXPIRY_MS`)
 * belongs to an attempt that can no longer be submitted — it is ignored and
 * deleted on load; logout clears them all (`clear-participation-storage.ts`).
 */
import { RESERVATION_EXPIRY_MS } from "@rescom/schemas";

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface AnswerDraft {
  version: 1;
  attemptId: string;
  answers: Record<string, unknown>;
  pageIndex: number;
  /** ISO time of the last save. */
  savedAt: string;
}

const PREFIX = "rescom:survey-draft:";

export function draftKey(attemptId: string): string {
  return `${PREFIX}${attemptId}`;
}

/** `window.localStorage`, or null when unavailable. */
export function browserDraftStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function saveAnswerDraft(
  storage: DraftStorage | null,
  input: { attemptId: string; answers: Record<string, unknown>; pageIndex: number; now?: Date },
): AnswerDraft | null {
  if (!storage) return null;
  const draft: AnswerDraft = {
    version: 1,
    attemptId: input.attemptId,
    answers: input.answers,
    pageIndex: Math.max(0, Math.floor(input.pageIndex)),
    savedAt: (input.now ?? new Date()).toISOString(),
  };
  try {
    storage.setItem(draftKey(input.attemptId), JSON.stringify(draft));
    return draft;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True when a draft saved at `savedAt` outlived the reservation window. */
export function isAnswerDraftExpired(savedAt: string, nowMs: number = Date.now()): boolean {
  const saved = Date.parse(savedAt);
  return !Number.isFinite(saved) || nowMs - saved > RESERVATION_EXPIRY_MS;
}

/**
 * The stored draft of this attempt, or null (missing, corrupt, other
 * attempt/version, or older than the reservation window — then deleted).
 */
export function loadAnswerDraft(
  storage: DraftStorage | null,
  attemptId: string,
  nowMs: number = Date.now(),
): AnswerDraft | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(draftKey(attemptId));
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearAnswerDraft(storage, attemptId);
    return null;
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    parsed.attemptId !== attemptId ||
    !isRecord(parsed.answers) ||
    typeof parsed.pageIndex !== "number" ||
    typeof parsed.savedAt !== "string" ||
    Number.isNaN(Date.parse(parsed.savedAt)) ||
    isAnswerDraftExpired(parsed.savedAt, nowMs)
  ) {
    clearAnswerDraft(storage, attemptId);
    return null;
  }
  return {
    version: 1,
    attemptId,
    answers: parsed.answers,
    pageIndex: Math.max(0, Math.floor(parsed.pageIndex)),
    savedAt: parsed.savedAt,
  };
}

export function clearAnswerDraft(storage: DraftStorage | null, attemptId: string): void {
  if (!storage) return;
  try {
    storage.removeItem(draftKey(attemptId));
  } catch {
    // Nothing to do: the draft simply stays until the browser clears it.
  }
}

/** Only answers for blocks that still exist in the form (a new version may drop some). */
export function restorableAnswers(draft: AnswerDraft, blockIds: Iterable<string>): Record<string, unknown> {
  const known = new Set(blockIds);
  return Object.fromEntries(Object.entries(draft.answers).filter(([id]) => known.has(id)));
}

/** Deletes every stored answer draft older than the reservation window (other attempts included). */
export function pruneExpiredAnswerDrafts(
  storage: (DraftStorage & Pick<Storage, "key"> & { readonly length: number }) | null,
  nowMs: number = Date.now(),
): void {
  if (!storage) return;
  try {
    const stale: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      let savedAt: unknown;
      try {
        savedAt = (JSON.parse(storage.getItem(key) ?? "null") as { savedAt?: unknown } | null)?.savedAt;
      } catch {
        savedAt = null;
      }
      if (typeof savedAt !== "string" || isAnswerDraftExpired(savedAt, nowMs)) stale.push(key);
    }
    for (const key of stale) storage.removeItem(key);
  } catch {
    // Blocked storage: nothing to prune.
  }
}
