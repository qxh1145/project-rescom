"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeInternalTimeBarrier, type FormBlock } from "@rescom/schemas";
import { useSurveyTelemetry } from "@/app/forms/hooks/useSurveyTelemetry";
import { isApiError } from "@/lib/api/api-error";
import {
  browserDraftStorage,
  clearAnswerDraft,
  loadAnswerDraft,
  restorableAnswers,
  saveAnswerDraft,
} from "@/lib/participation/answer-draft";
import type { AttemptDetails } from "@/lib/participation/attempts-service";
import {
  invalidBlockIds,
  isAttemptExpiredError,
  isOfflineFailure,
  submitSurveyErrorMessage,
  timeBarrierRemainingSeconds,
} from "@/lib/participation/participation-messages";
import { stashSubmission, submitSurveyResponse } from "@/lib/participation/submission-service";
import {
  answerEventType,
  buildSurveyLayout,
  countAnswered,
  firstPageWith,
  toSubmissionAnswers,
  validateBlocks,
} from "@/lib/participation/survey-form";
import type { SurveyForm } from "@/lib/participation/survey-form-service";
import { useSession } from "@/lib/session/SessionProvider";

export type RunnerPhase = "answering" | "submitting" | "offline" | "expired";

const AUTOSAVE_DELAY_MS = 600;
const FREE_TEXT = new Set<FormBlock["type"]>(["text", "textarea", "number"]);

function initialDraft(attemptId: string) {
  return loadAnswerDraft(browserDraftStorage(), attemptId);
}

/**
 * State machine of an in-Rescom attempt (Figma 4 / 4b): answers + page,
 * local autosave, page validation, time barrier, submit and its failures.
 * Mounted only once the attempt and its form are loaded, so the draft is
 * restored synchronously in the state initializers.
 */
export function useSurveyRunner(attempt: AttemptDetails, form: SurveyForm) {
  const router = useRouter();
  const { refresh } = useSession();
  const storage = useMemo(() => browserDraftStorage(), []);
  const layout = useMemo(() => buildSurveyLayout(form.blocks, form.sections), [form]);
  const lastPage = Math.max(0, layout.pages.length - 1);

  const [restored] = useState(() => initialDraft(attempt.attemptId));
  const [answers, setAnswers] = useState<Record<string, unknown>>(() =>
    restored ? restorableAnswers(restored, form.blocks.map((block) => block.id)) : {},
  );
  const [pageIndex, setPageIndex] = useState(() => Math.min(restored?.pageIndex ?? 0, lastPage));
  const [furthestPage, setFurthestPage] = useState(() => Math.min(restored?.pageIndex ?? 0, lastPage));
  const [savedAt, setSavedAt] = useState<string | null>(() => restored?.savedAt ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<RunnerPhase>(() =>
    attempt.status === "EXPIRED" || Date.parse(attempt.expiresAt) <= Date.now() ? "expired" : "answering",
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  // 4b stays on screen while "Thử gửi lại" is in flight.
  const [offlineRetry, setOfflineRetry] = useState(false);
  const [barrierUntil, setBarrierUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const answersRef = useRef(answers);
  const pageRef = useRef(pageIndex);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const telemetry = useSurveyTelemetry({
    formId: attempt.formId,
    attemptId: attempt.attemptId,
    responseId: attempt.responseId,
    formVersionId: attempt.formVersionId,
    enabled: phase !== "expired",
  });
  const { recordEvent, flushQueue } = telemetry;

  const saveNow = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const draft = saveAnswerDraft(storage, {
      attemptId: attempt.attemptId,
      answers: answersRef.current,
      pageIndex: pageRef.current,
    });
    if (draft) setSavedAt(draft.savedAt);
  }, [attempt.attemptId, storage]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveNow, AUTOSAVE_DELAY_MS);
  }, [saveNow]);

  // Keep a pending save from being lost when the page unmounts.
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveAnswerDraft(storage, { attemptId: attempt.attemptId, answers: answersRef.current, pageIndex: pageRef.current });
      }
    },
    [attempt.attemptId, storage],
  );

  // Telemetry: start/resume once, then every page's questions as they are shown.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current || !telemetry.isEnabled) return;
    startedRef.current = true;
    recordEvent(restored ? "SURVEY_ATTEMPT_RESUMED" : "SURVEY_ATTEMPT_STARTED");
  }, [recordEvent, restored, telemetry.isEnabled]);

  const page = layout.pages[pageIndex] ?? layout.pages[0];
  useEffect(() => {
    if (phase !== "answering" || !page) return;
    for (const block of page.blocks) recordEvent("QUESTION_SHOWN", block.id);
  }, [page, phase, recordEvent]);

  // Time barrier countdown (1 s ticks only while blocked).
  useEffect(() => {
    if (barrierUntil === null) return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= barrierUntil) setBarrierUntil(null);
    }, 1000);
    return () => clearInterval(timer);
  }, [barrierUntil]);

  const barrierSeconds = barrierUntil === null ? 0 : Math.max(0, Math.ceil((barrierUntil - now) / 1000));
  const requiredSeconds = useMemo(
    () => computeInternalTimeBarrier({ blocks: form.blocks, metadata: form.metadata }).requiredSeconds,
    [form],
  );

  const setAnswer = useCallback(
    (block: FormBlock, value: unknown) => {
      const previous = answersRef.current[block.id];
      const next = { ...answersRef.current, [block.id]: value };
      answersRef.current = next;
      setAnswers(next);
      setErrors((current) => {
        if (!current[block.id]) return current;
        const rest = { ...current };
        delete rest[block.id];
        return rest;
      });
      // Free text reports on blur; choices report each change.
      if (!FREE_TEXT.has(block.type)) {
        const event = answerEventType(block, previous, value);
        if (event) recordEvent(event, block.id);
      }
      scheduleSave();
    },
    [recordEvent, scheduleSave],
  );

  // Last value each free-text answer reported (starts from the restored draft).
  const focusValues = useRef<Record<string, unknown>>({ ...answers });
  const blurAnswer = useCallback(
    (block: FormBlock) => {
      const before = focusValues.current[block.id];
      const after = answersRef.current[block.id];
      if (before === after) return;
      focusValues.current[block.id] = after;
      const event = answerEventType(block, before, after);
      if (event) recordEvent(event, block.id);
    },
    [recordEvent],
  );

  const goToPage = useCallback(
    (index: number) => {
      const target = Math.max(0, Math.min(index, lastPage));
      pageRef.current = target;
      setPageIndex(target);
      setFurthestPage((current) => Math.max(current, target));
      setSubmitError(null);
      saveNow();
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [lastPage, saveNow],
  );

  const showErrors = useCallback((found: Record<string, string>) => {
    setErrors(found);
    const first = Object.keys(found)[0];
    if (!first) return;
    for (const id of Object.keys(found)) recordEvent("QUESTION_SKIPPED", id);
    requestAnimationFrame(() => document.getElementById(`q-${first}`)?.scrollIntoView({ behavior: "smooth" }));
  }, [recordEvent]);

  const next = useCallback(() => {
    if (!page) return;
    const found = validateBlocks(page.blocks, answersRef.current);
    if (Object.keys(found).length > 0) {
      showErrors(found);
      return;
    }
    setErrors({});
    goToPage(pageIndex + 1);
  }, [goToPage, page, pageIndex, showErrors]);

  const back = useCallback(() => {
    for (const block of layout.pages[pageIndex - 1]?.blocks ?? []) recordEvent("QUESTION_RETURNED", block.id);
    goToPage(pageIndex - 1);
  }, [goToPage, layout.pages, pageIndex, recordEvent]);

  const jumpToSection = useCallback(
    (sectionIndex: number) => {
      const section = layout.sections[sectionIndex];
      if (section) goToPage(section.firstPage);
    },
    [goToPage, layout.sections],
  );

  const saveAndExit = useCallback(() => {
    saveNow();
    void flushQueue();
    router.push("/marketplace");
  }, [flushQueue, router, saveNow]);

  const submit = useCallback(async () => {
    const all = validateBlocks(form.blocks, answersRef.current);
    if (Object.keys(all).length > 0) {
      const target = firstPageWith(layout, Object.keys(all));
      if (target >= 0 && target !== pageIndex) goToPage(target);
      showErrors(all);
      setPhase("answering");
      return;
    }
    const earliest = Date.parse(attempt.startedAt) + requiredSeconds * 1000;
    if (Date.now() < earliest) {
      recordEvent("TIME_BARRIER_TRIGGERED");
      setNow(Date.now());
      setBarrierUntil(earliest);
      return;
    }
    if (!attempt.responseId) {
      setSubmitError("Không tìm thấy lượt làm này. Hãy mở lại khảo sát từ trang Khám phá.");
      return;
    }

    saveNow();
    setSubmitError(null);
    setPhase("submitting");
    try {
      const result = await submitSurveyResponse(attempt.responseId, {
        attemptId: attempt.attemptId,
        answers: toSubmissionAnswers(form.blocks, answersRef.current),
      });
      recordEvent("SURVEY_SUBMITTED");
      void flushQueue();
      stashSubmission(result);
      clearAnswerDraft(storage, attempt.attemptId);
      refresh();
      router.replace(`/attempts/${attempt.attemptId}/complete`);
    } catch (cause) {
      if (isOfflineFailure(cause)) {
        setOfflineRetry(true);
        setPhase("offline");
        return;
      }
      setOfflineRetry(false);
      if (isAttemptExpiredError(cause)) {
        setPhase("expired");
        return;
      }
      if (isApiError(cause) && cause.code === "SURVEY_ALREADY_COMPLETED") {
        clearAnswerDraft(storage, attempt.attemptId);
        router.replace(`/attempts/${attempt.attemptId}/complete`);
        return;
      }
      setPhase("answering");
      const remaining = timeBarrierRemainingSeconds(cause);
      if (remaining !== null) {
        recordEvent("TIME_BARRIER_TRIGGERED");
        setNow(Date.now());
        setBarrierUntil(Date.now() + remaining * 1000);
        return;
      }
      const invalid = invalidBlockIds(cause);
      if (invalid.length > 0) {
        const target = firstPageWith(layout, invalid);
        if (target >= 0) goToPage(target);
        showErrors(Object.fromEntries(invalid.map((id) => [id, "Câu trả lời chưa hợp lệ, hãy kiểm tra lại."])));
      }
      setSubmitError(submitSurveyErrorMessage(cause));
    }
  }, [
    attempt,
    flushQueue,
    form.blocks,
    goToPage,
    layout,
    pageIndex,
    recordEvent,
    refresh,
    requiredSeconds,
    router,
    saveNow,
    showErrors,
    storage,
  ]);

  const review = useCallback(() => {
    setOfflineRetry(false);
    setPhase("answering");
    goToPage(0);
  }, [goToPage]);

  const forgetDraft = useCallback(() => clearAnswerDraft(storage, attempt.attemptId), [attempt.attemptId, storage]);

  return {
    layout,
    page,
    pageIndex,
    isLastPage: pageIndex >= lastPage,
    furthestSection: layout.pages[furthestPage]?.sectionIndex ?? 0,
    answers,
    errors,
    phase,
    /** Figma 4b: the last submit failed without a response (kept during the retry). */
    showOffline: phase === "offline" || (phase === "submitting" && offlineRetry),
    submitError,
    savedAt,
    answeredCount: countAnswered(form.blocks, answers),
    barrierSeconds,
    setAnswer,
    blurAnswer,
    next,
    back,
    jumpToSection,
    saveAndExit,
    submit,
    review,
    forgetDraft,
  };
}
