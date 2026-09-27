import {
  COMPLETION_CODE_POLICY,
  DEFAULT_EXTERNAL_TIME_BARRIER_SECONDS,
  isCompletionCodeLimitReached,
  remainingCompletionCodeTries,
  timeBarrierRejectionDetailsSchema,
} from "@rescom/schemas";
import { isApiError } from "../api/api-error.ts";
import { sessionStatusFromError } from "../session/session-status.ts";
import { attemptPhase, type AttemptStatus } from "./attempts-service.ts";
import { EXTERNAL_MESSAGES } from "./external-messages.ts";
import { completionsLimitMessage } from "./start-flow.ts";

/**
 * Pure rules of the Google Forms flow (`/attempts/[id]/google-form`),
 * unit-tested in `tests/external-code.test.mjs`.
 */

/** `verifyExternalCompletionCodeInputSchema`: exactly 6 digits. */
export const COMPLETION_CODE_LENGTH = 6;
/** `completion-code-policy-v1`: 3 wrong codes lock one attempt. */
export const MAX_CODE_TRIES = COMPLETION_CODE_POLICY.maxFailuresPerAttempt;

// ── Time barrier ────────────────────────────────────────────────────────────

interface BarrierSource {
  startedAt: string;
  /** `attemptTimeBarrierSchema` (start response, or the ASSUMED GET /attempts/:id). */
  timeBarrier?: { earliestSubmitAt: string } | null;
}

/**
 * Epoch ms from which the server accepts a code. The announced
 * `earliestSubmitAt` wins; without it the backend's External default applies
 * (`DEFAULT_EXTERNAL_TIME_BARRIER_SECONDS` after the server-recorded start —
 * a publisher minimum can only make it later, which the server then reports
 * with 422 SUBMISSION_TOO_FAST).
 */
export function barrierDeadlineMs(attempt: BarrierSource): number {
  const announced = attempt.timeBarrier ? Date.parse(attempt.timeBarrier.earliestSubmitAt) : Number.NaN;
  if (Number.isFinite(announced)) return announced;
  return Date.parse(attempt.startedAt) + DEFAULT_EXTERNAL_TIME_BARRIER_SECONDS * 1000;
}

/** Whole seconds left before the code can be confirmed (rounded up, never negative). */
export function barrierRemainingSeconds(deadlineMs: number, nowMs: number): number {
  if (!Number.isFinite(deadlineMs)) return 0;
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

/** Figma countdown "04:12"; hours only when needed ("1:04:12"). */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** "Xác nhận mã" is enabled only when the barrier passed AND 6 digits are entered. */
export function canConfirmCode(input: { remainingSeconds: number; code: string; busy?: boolean }): boolean {
  return (
    !input.busy &&
    input.remainingSeconds <= 0 &&
    input.code.length === COMPLETION_CODE_LENGTH &&
    /^\d+$/.test(input.code)
  );
}

// ── Attempt status → screen ────────────────────────────────────────────────

export type CodeLockReason = "attempt" | "account-limit";

export type GoogleFormScreen =
  | { kind: "redirect"; href: string }
  | { kind: "form" }
  /** Figma 5c (`attempt`) or the ASSUMED account+version limit screen. */
  | { kind: "locked"; reason: CodeLockReason }
  /** ASSUMED (not drawn): the 30-minute reservation ran out or the attempt was cancelled. */
  | { kind: "closed"; reason: "expired" | "cancelled" };

export function screenForAttempt(
  attempt: {
    attemptId: string;
    type: "INTERNAL" | "EXTERNAL";
    status: AttemptStatus;
    expiresAt: string;
    closedReason?: "EXPIRED" | "CANCELLED" | null;
    accountWrongCodeCount?: number;
  },
  nowMs: number = Date.now(),
): GoogleFormScreen {
  const base = `/attempts/${encodeURIComponent(attempt.attemptId)}`;
  if (attempt.type === "INTERNAL") return { kind: "redirect", href: base };
  switch (attemptPhase(attempt, nowMs)) {
    case "completed":
      return { kind: "redirect", href: `${base}/complete` };
    case "locked":
      return { kind: "locked", reason: "attempt" };
    case "expired":
      return { kind: "closed", reason: "expired" };
    case "cancelled":
      return { kind: "closed", reason: "cancelled" };
    default:
      // The account used every try on this version (decision E5-D1): no code can be accepted.
      return isAccountCodeBudgetUsed(attempt.accountWrongCodeCount)
        ? { kind: "locked", reason: "account-limit" }
        : { kind: "form" };
  }
}

/** True when the known account+version wrong-code total reached the policy limit. */
export function isAccountCodeBudgetUsed(accountWrongCodeCount: number | undefined): boolean {
  return accountWrongCodeCount !== undefined && isCompletionCodeLimitReached(accountWrongCodeCount);
}

// ── Verify-code errors → UI state ──────────────────────────────────────────

export type VerifyFailure =
  /** 400 INVALID_COMPLETION_CODE (Figma 5b). */
  | { kind: "wrong"; remainingTries: number }
  /** 409 ATTEMPT_LOCKED (Figma 5c) or 409 COMPLETION_CODE_LIMIT_REACHED (6 wrong codes on the version). */
  | { kind: "locked"; reason: CodeLockReason }
  /** 422 SUBMISSION_TOO_FAST: restart the countdown from the server's numbers. */
  | { kind: "too-fast"; remainingSeconds: number }
  /** 409 ATTEMPT_EXPIRED. */
  | { kind: "expired" }
  /** 401 / AUTH_USER_LOCKED: `SessionGate` takes over after `refresh()`. */
  | { kind: "session" }
  | { kind: "message"; message: string };

/**
 * Tries left from `details.remainingAttempts` of 400 INVALID_COMPLETION_CODE
 * (`http-exception.filter.ts`), clamped to the policy. Without details, one
 * try fewer than `previousWrongCount + 1` allows.
 */
export function remainingTriesFrom(details: unknown, previousWrongCount = 0): number {
  const raw =
    typeof details === "object" && details !== null
      ? (details as { remainingAttempts?: unknown }).remainingAttempts
      : undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(0, Math.min(MAX_CODE_TRIES, Math.floor(raw)));
  }
  return Math.max(0, MAX_CODE_TRIES - (previousWrongCount + 1));
}

/**
 * Tries left shown on load (ASSUMED GET /attempts/:id exposes `wrongCodeCount`
 * and, when known, the account+version total `accountWrongCodeCount`): the
 * smaller of the attempt's and the account's budget, like the backend.
 */
export function remainingTriesFromCount(wrongCodeCount: number, accountWrongCodeCount?: number): number {
  if (accountWrongCodeCount === undefined) {
    return Math.max(0, MAX_CODE_TRIES - Math.max(0, Math.floor(wrongCodeCount)));
  }
  return remainingCompletionCodeTries({ attemptFailures: wrongCodeCount, accountFailures: accountWrongCodeCount });
}

export function verifyFailureOf(error: unknown, previousWrongCount = 0): VerifyFailure {
  if (!isApiError(error)) return { kind: "message", message: EXTERNAL_MESSAGES.generic };
  if (error.kind === "network") return { kind: "message", message: EXTERNAL_MESSAGES.network };
  const session = sessionStatusFromError(error);
  if (session === "unauthenticated" || session === "locked") return { kind: "session" };

  switch (error.code) {
    case "INVALID_COMPLETION_CODE": {
      const remainingTries = remainingTriesFrom(error.details, previousWrongCount);
      if (remainingTries > 0) return { kind: "wrong", remainingTries };
      // No try left although this attempt is not at its own limit: the account's
      // budget on this version ran out (the backend locks the attempt with 409
      // ATTEMPT_LOCKED instead when the attempt itself is used up).
      return {
        kind: "locked",
        reason: previousWrongCount + 1 < MAX_CODE_TRIES ? "account-limit" : "attempt",
      };
    }
    case "ATTEMPT_LOCKED":
      return { kind: "locked", reason: "attempt" };
    case "COMPLETION_CODE_LIMIT_REACHED":
      return { kind: "locked", reason: "account-limit" };
    case "SUBMISSION_TOO_FAST": {
      const parsed = timeBarrierRejectionDetailsSchema.safeParse(error.details);
      const remainingSeconds = parsed.success
        ? parsed.data.remainingSeconds
        : Math.max(1, error.retryAfterSeconds ?? 1);
      return { kind: "too-fast", remainingSeconds };
    }
    case "ATTEMPT_EXPIRED":
      return { kind: "expired" };
    case "SURVEY_ALREADY_COMPLETED":
      return { kind: "message", message: EXTERNAL_MESSAGES.alreadyCompleted };
    case "SURVEY_NOT_AVAILABLE":
      return { kind: "message", message: EXTERNAL_MESSAGES.notAvailable };
    case "PARTICIPATION_RATE_LIMITED":
      return { kind: "message", message: completionsLimitMessage(error) ?? EXTERNAL_MESSAGES.rateLimited };
    case "VALIDATION_ERROR":
      return { kind: "message", message: EXTERNAL_MESSAGES.invalidFormat };
    default:
      return { kind: "message", message: EXTERNAL_MESSAGES.generic };
  }
}

// ── Report missing code ────────────────────────────────────────────────────

/** `reportMissingCompletionCodeInputSchema`: trimmed reason, 5–1000 chars. */
export const REPORT_REASON_MIN = 5;
export const REPORT_REASON_MAX = 1000;

export function reportReasonError(reason: string): string | null {
  return reason.trim().length < REPORT_REASON_MIN ? EXTERNAL_MESSAGES.reportReasonTooShort : null;
}

export function reportFailureMessage(error: unknown): string {
  if (!isApiError(error)) return EXTERNAL_MESSAGES.reportFailed;
  if (error.kind === "network") return EXTERNAL_MESSAGES.network;
  switch (error.code) {
    // VERIFIED backend refuses reports on a LOCKED attempt (contract gap with Figma 5c).
    case "ATTEMPT_LOCKED":
      return EXTERNAL_MESSAGES.reportLocked;
    case "SURVEY_ALREADY_COMPLETED":
      return EXTERNAL_MESSAGES.reportCompleted;
    case "ATTEMPT_EXPIRED":
      return EXTERNAL_MESSAGES.reportExpired;
    case "VALIDATION_ERROR":
      return EXTERNAL_MESSAGES.reportReasonTooShort;
    case "PARTICIPATION_RATE_LIMITED":
      return EXTERNAL_MESSAGES.rateLimited;
    default:
      return EXTERNAL_MESSAGES.reportFailed;
  }
}

// ── Per-attempt draft (sessionStorage) ─────────────────────────────────────

export interface GoogleFormDraft {
  /** OtpInput value: fixed length, a space per empty box (`""` = empty). */
  code: string;
  /** Step 1 done: the form was opened in a new tab. */
  opened: boolean;
}

export const EMPTY_GOOGLE_FORM_DRAFT: GoogleFormDraft = { code: "", opened: false };

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function googleFormDraftKey(attemptId: string): string {
  return `rescom:google-form-draft:${attemptId}`;
}

export function readGoogleFormDraft(storage: DraftStorage | null, attemptId: string): GoogleFormDraft {
  if (!storage) return EMPTY_GOOGLE_FORM_DRAFT;
  try {
    const raw = storage.getItem(googleFormDraftKey(attemptId));
    if (!raw) return EMPTY_GOOGLE_FORM_DRAFT;
    const parsed = JSON.parse(raw) as Partial<GoogleFormDraft>;
    const code =
      typeof parsed.code === "string" && parsed.code.length <= COMPLETION_CODE_LENGTH && /^[\d ]*$/.test(parsed.code)
        ? parsed.code
        : "";
    return { code, opened: parsed.opened === true };
  } catch {
    return EMPTY_GOOGLE_FORM_DRAFT;
  }
}

export function writeGoogleFormDraft(storage: DraftStorage | null, attemptId: string, draft: GoogleFormDraft): void {
  if (!storage) return;
  try {
    if (!draft.opened && draft.code.trim() === "") storage.removeItem(googleFormDraftKey(attemptId));
    else storage.setItem(googleFormDraftKey(attemptId), JSON.stringify(draft));
  } catch {
    // Storage full or blocked: the draft is a convenience only.
  }
}

export function clearGoogleFormDraft(storage: DraftStorage | null, attemptId: string): void {
  try {
    storage?.removeItem(googleFormDraftKey(attemptId));
  } catch {
    // ignore
  }
}
