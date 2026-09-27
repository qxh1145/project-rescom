/**
 * Local draft of an in-Rescom attempt (Figma 4 "Lưu và thoát", 4b "Đã lưu
 * trên máy lúc 14:31"). The backend has no draft route, so answers live in
 * localStorage per attempt until the submit succeeds. Storage may be missing
 * or throw (private mode): every helper then degrades to a no-op.
 */

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
export function browserDraftStorage(): DraftStorage | null {
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

/** The stored draft of this attempt, or null (missing, corrupt, other attempt/version). */
export function loadAnswerDraft(storage: DraftStorage | null, attemptId: string): AnswerDraft | null {
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
    Number.isNaN(Date.parse(parsed.savedAt))
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
