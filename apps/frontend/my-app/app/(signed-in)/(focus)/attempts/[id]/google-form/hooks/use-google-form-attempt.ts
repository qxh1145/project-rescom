"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
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

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export type LockReason = "attempt" | "account-limit";

export type ResolvedScreen =
  | GoogleFormScreen
  | { kind: "locked"; reason: LockReason };

interface WrongCode {
  remainingTries: number;
  /** The code the server refused (boxes stay red until it is edited). */
  code: string | null;
}

/**
 * State of `/attempts/[id]/google-form` (Figma page 5): loads the attempt
 * (ASSUMED `GET /attempts/:id`), counts down the time barrier, keeps the
 * typed code + "form opened" per attempt in sessionStorage and verifies the
 * code (VERIFIED `POST /attempts/:id/verify-code`).
 */
export function useGoogleFormAttempt(attemptId: string) {
  const router = useRouter();
  const { refresh } = useSession();
  const query = useApiQuery(`attempt:${attemptId}`, (signal) => getAttempt(attemptId, signal));
  const attempt = query.data;

  const [draft, setDraft] = useState<GoogleFormDraft>(() => readGoogleFormDraft(sessionStore(), attemptId));
  const [override, setOverride] = useState<ResolvedScreen | null>(null);
  const [wrong, setWrong] = useState<WrongCode | null>(null);
  const [notice, setNotice] = useState<{ tone: "danger" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deadlineOverride, setDeadlineOverride] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const screen: ResolvedScreen | null = override ?? (attempt ? screenForAttempt(attempt) : null);
  const deadline = deadlineOverride ?? (attempt ? barrierDeadlineMs(attempt) : Number.NaN);
  const remainingSeconds = attempt ? barrierRemainingSeconds(deadline, now) : 0;
  const counting = remainingSeconds > 0;

  // Countdown: one tick per second while the barrier is running.
  useEffect(() => {
    if (!counting) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [counting, deadline]);

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

  // A wrong code survives a reload through the attempt's server-owned counter.
  const shownWrong: WrongCode | null =
    wrong ??
    (attempt && attempt.wrongCodeCount > 0 && attempt.status === "IN_PROGRESS"
      ? { remainingTries: remainingTriesFromCount(attempt.wrongCodeCount), code: null }
      : null);

  const code = draft.code;
  const complete = isOtpComplete(code, COMPLETION_CODE_LENGTH);
  const canConfirm = canConfirmCode({ remainingSeconds, code: complete ? code : "", busy });

  const confirm = async () => {
    if (!canConfirm || !attempt) return;
    setBusy(true);
    setNotice(null);
    try {
      await verifyCompletionCode(attemptId, code);
      clearGoogleFormDraft(sessionStore(), attemptId);
      refresh();
      router.replace(`/attempts/${encodeURIComponent(attemptId)}/complete`);
      return; // stay busy until the next screen mounts
    } catch (error) {
      const previous = attempt.wrongCodeCount + (wrong ? 1 : 0);
      const failure = verifyFailureOf(error, previous);
      switch (failure.kind) {
        case "wrong":
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
    setBusy(false);
  };

  return {
    query,
    attempt,
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
  };
}

export type GoogleFormAttemptState = ReturnType<typeof useGoogleFormAttempt>;
