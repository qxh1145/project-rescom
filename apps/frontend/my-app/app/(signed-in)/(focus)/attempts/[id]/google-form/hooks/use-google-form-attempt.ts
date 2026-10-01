"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { externalSurveyUrlSchema } from "@rescom/schemas";
import { isOtpComplete } from "@/components/ui/otp-slots";
import { useApiQuery } from "@/lib/api/use-api-query";
import { getAttempt } from "@/lib/participation/attempts-service";
import {
  COMPLETION_CODE_LENGTH,
  barrierDeadlineMs,
  barrierRemainingSeconds,
  canConfirmCode,
  clearGoogleFormDraft,
  formatCountdown,
  readGoogleFormDraft,
  remainingTriesFromCount,
  screenForAttempt,
  verifyFailureOf,
  writeGoogleFormDraft,
  type GoogleFormDraft,
  type GoogleFormScreen,
} from "@/lib/participation/external-code";
import { EXTERNAL_MESSAGES } from "@/lib/participation/external-messages";
import { verifyCompletionCode } from "@/lib/participation/external-service";
import { useSession } from "@/lib/session/SessionProvider";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export type ResolvedScreen = GoogleFormScreen;

interface WrongCode {
  remainingTries: number;
  /** The code the server refused (boxes stay red until it is edited). */
  code: string | null;
}

/**
 * State of `/attempts/[id]/google-form` (Figma page 5): loads the attempt
 * (`GET /attempts/:id`), counts down the time barrier, keeps the
 * typed code + "form opened" per attempt in sessionStorage and verifies the
 * code (VERIFIED `POST /attempts/:id/verify-code`).
 */
export function useGoogleFormAttempt(attemptId: string) {
  const router = useRouter();
  const { refresh } = useSession();
  const query = useApiQuery(`attempt:${attemptId}`, (signal) => getAttempt(attemptId, signal));
  const attempt = query.data;
  // 401 / locked account on load: SessionGate redirects (the typed code stays in sessionStorage).
  const sessionLost = useSessionLossRedirect(query.error);

  const [draft, setDraft] = useState<GoogleFormDraft>(() => readGoogleFormDraft(sessionStore(), attemptId));
  const [override, setOverride] = useState<ResolvedScreen | null>(null);
  const [wrong, setWrong] = useState<WrongCode | null>(null);
  const [notice, setNotice] = useState<{ tone: "danger" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  /** Double-submit guard: a second click can land before `busy` re-renders. */
  const busyRef = useRef(false);
  /** Wrong codes refused in this page session (the loaded `wrongCodeCount` is from before). */
  const [sessionWrongCount, setSessionWrongCount] = useState(0);
  const [deadlineOverride, setDeadlineOverride] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const screen: ResolvedScreen | null = override ?? (attempt ? screenForAttempt(attempt, now) : null);
  const deadline = deadlineOverride ?? (attempt ? barrierDeadlineMs(attempt) : Number.NaN);
  const remainingSeconds = attempt ? barrierRemainingSeconds(deadline, now) : 0;
  const counting = remainingSeconds > 0;

  // Countdown: one tick per second while the barrier is running.
  useEffect(() => {
    if (!counting) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [counting, deadline]);

  // Background tabs throttle timers: catch up (countdown, expiry) as soon as the tab is visible again.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const redirectHref = screen?.kind === "redirect" ? screen.href : null;
  useEffect(() => {
    if (redirectHref) router.replace(redirectHref);
  }, [router, redirectHref]);

  const updateDraft = useCallback(
    (patch: Partial<GoogleFormDraft>) => {
      setDraft((current) => {
        const next = { ...current, ...patch };
        writeGoogleFormDraft(sessionStore(), attemptId, next);
        return next;
      });
    },
    [attemptId],
  );

  // A wrong code survives a reload through the server-owned counters: the smaller of the
  // attempt's and the account's budget (an exhausted account budget shows the
  // account-limit screen instead, see `screenForAttempt`).
  const shownWrong: WrongCode | null =
    wrong ??
    (attempt && attempt.wrongCodeCount > 0 && attempt.status === "IN_PROGRESS"
      ? { remainingTries: remainingTriesFromCount(attempt.wrongCodeCount, attempt.accountWrongCodeCount), code: null }
      : null);

  // Only a Google Forms link (shared allowlist) is ever opened from Rescom.
  const rawUrl = attempt?.survey.externalUrl ?? null;
  const formUrl = rawUrl && externalSurveyUrlSchema.safeParse(rawUrl).success ? rawUrl.trim() : null;

  const code = draft.code;
  const complete = isOtpComplete(code, COMPLETION_CODE_LENGTH);
  const canConfirm = canConfirmCode({ remainingSeconds, code: complete ? code : "", busy });

  const confirm = async () => {
    if (!canConfirm || !attempt || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await verifyCompletionCode(attemptId, code);
      clearGoogleFormDraft(sessionStore(), attemptId);
      refresh();
      router.replace(`/attempts/${encodeURIComponent(attemptId)}/complete`);
      return; // stay busy until the next screen mounts
    } catch (error) {
      const previous = attempt.wrongCodeCount + sessionWrongCount;
      const failure = verifyFailureOf(error, previous);
      switch (failure.kind) {
        case "wrong":
          setSessionWrongCount((count) => count + 1);
          setWrong({ remainingTries: failure.remainingTries, code });
          break;
        case "locked":
          clearGoogleFormDraft(sessionStore(), attemptId);
          setOverride({ kind: "locked", reason: failure.reason });
          break;
        case "too-fast": {
          const at = Date.now();
          setNow(at);
          setDeadlineOverride(at + failure.remainingSeconds * 1000);
          setNotice({ tone: "info", text: EXTERNAL_MESSAGES.tooFast(formatCountdown(failure.remainingSeconds)) });
          break;
        }
        case "expired":
          setOverride({ kind: "closed", reason: "expired" });
          break;
        case "session":
          refresh();
          break;
        case "message":
          setNotice({ tone: "danger", text: failure.message });
          break;
      }
    }
    busyRef.current = false;
    setBusy(false);
  };

  return {
    query,
    sessionLost,
    attempt,
    /** The Google Form link when it passes `externalSurveyUrlSchema`; null → "báo Admin" message. */
    formUrl,
    /** A link exists but is not an allowed Google Forms URL. */
    formUrlInvalid: rawUrl !== null && formUrl === null,
    screen,
    code,
    setCode: (value: string) => updateDraft({ code: value }),
    opened: draft.opened,
    markOpened: () => updateDraft({ opened: true }),
    remainingSeconds,
    countdown: formatCountdown(remainingSeconds),
    wrong: shownWrong,
    /** Red boxes: the refused code is still in the boxes. */
    invalid: shownWrong !== null && shownWrong.code !== null && shownWrong.code === code,
    notice,
    busy,
    canConfirm,
    confirm,
    /** After "Huỷ lượt làm" succeeded. */
    cancelled: () => {
      clearGoogleFormDraft(sessionStore(), attemptId);
      router.replace("/marketplace");
    },
    /** "Huỷ lượt làm" found the attempt already completed (409 ATTEMPT_NOT_IN_PROGRESS, COMPLETED). */
    completed: () => {
      clearGoogleFormDraft(sessionStore(), attemptId);
      router.replace(`/attempts/${encodeURIComponent(attemptId)}/complete`);
    },
  };
}

export type GoogleFormAttemptState = ReturnType<typeof useGoogleFormAttempt>;
