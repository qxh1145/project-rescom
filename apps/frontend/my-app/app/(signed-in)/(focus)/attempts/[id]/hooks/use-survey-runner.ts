"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeInternalTimeBarrier,
  type FileAttachmentAnswer,
  type FileUploadBlock,
  type FormBlock,
} from "@rescom/schemas";
import { useSurveyTelemetry } from "@/app/forms/hooks/useSurveyTelemetry";
import { isApiError } from "@/lib/api/api-error";
import { useApiQuery } from "@/lib/api/use-api-query";
import {
  browserDraftStorage,
  clearAnswerDraft,
  loadAnswerDraft,
  pruneExpiredAnswerDrafts,
  restorableAnswers,
  saveAnswerDraft,
} from "@/lib/participation/answer-draft";
import { attemptPhase, type AttemptDetails, type AttemptPinnedForm } from "@/lib/participation/attempts-service";
import { getIntegrityConsent } from "@/lib/participation/consent-service";
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
import { isFileAttachmentList, uncleanAttachmentFiles } from "@/lib/participation/file-upload";
import { isSessionLost } from "@/lib/session/session-status";
import { useSession } from "@/lib/session/SessionProvider";
import { useFileUploads } from "./use-file-uploads";

export type RunnerPhase = "answering" | "submitting" | "offline" | "expired";

const AUTOSAVE_DELAY_MS = 600;
const UPLOAD_IN_PROGRESS = "Tệp đang được tải lên. Vui lòng đợi tải xong.";
/** ASSUMED (design) (not in Figma): "sắp hết giờ giữ chỗ" notice 5 minutes before `expiresAt`. */
export const EXPIRY_WARNING_MS = 5 * 60 * 1000;
const FREE_TEXT = new Set<FormBlock["type"]>(["text", "textarea", "number"]);
const FOCUSABLE = "input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])";

function initialDraft(attemptId: string) {
  const storage = browserDraftStorage();
  // Drafts of attempts past the reservation window can never be sent: drop them.
  pruneExpiredAnswerDrafts(storage);
  return loadAnswerDraft(storage, attemptId);
}

type FocusRequest = { kind: "page" } | { kind: "invalid"; blockId: string };

/** Moves focus after a page change (first question heading) or a failed validation (first invalid control). */
function applyFocus(request: FocusRequest, firstBlockId: string | undefined): void {
  if (request.kind === "invalid") {
    const section = document.getElementById(`q-${request.blockId}`);
    const control = section?.querySelector<HTMLElement>(FOCUSABLE);
    (control ?? document.getElementById(`q-${request.blockId}-title`))?.focus({ preventScroll: true });
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (firstBlockId) document.getElementById(`q-${firstBlockId}-title`)?.focus({ preventScroll: true });
}

/**
 * State machine of an in-Rescom attempt (Figma 4 / 4b): answers + page,
 * local autosave, page validation, time barrier, submit and its failures.
 * Mounted only once the attempt and its form are loaded, so the draft is
 * restored synchronously in the state initializers.
 */
export function useSurveyRunner(attempt: AttemptDetails, form: AttemptPinnedForm) {
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
    attemptPhase(attempt) === "expired" ? "expired" : "answering",
  );
  const [expiringSoon, setExpiringSoon] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // 4b stays on screen while "Thử gửi lại" is in flight.
  const [offlineRetry, setOfflineRetry] = useState(false);
  const [barrierUntil, setBarrierUntil] = useState<number | null>(null);
  /** Seconds left when the barrier was hit: the static figure screen readers get. */
  const [barrierStartSeconds, setBarrierStartSeconds] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  const answersRef = useRef(answers);
  const pageRef = useRef(pageIndex);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Set once the submit succeeded: no autosave may bring the draft back. */
  const submittedRef = useRef(false);
  /** Double-submit guard (a second click lands before `phase` re-renders). */
  const busyRef = useRef(false);
  const focusRequest = useRef<FocusRequest | null>(null);
  const blockIds = useMemo(() => new Set(form.blocks.map((block) => block.id)), [form]);

  // Telemetry batches carry the notice version the respondent accepted.
  const consent = useApiQuery("integrity-consent", (signal) => getIntegrityConsent(signal));
  const telemetry = useSurveyTelemetry({
    formId: attempt.formId,
    attemptId: attempt.attemptId,
    responseId: attempt.responseId,
    formVersionId: attempt.formVersionId,
    enabled: phase !== "expired",
    consentNoticeVersion: consent.data?.acceptedVersion ?? null,
  });
  const { recordEvent, flushQueue } = telemetry;

  const saveNow = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    if (submittedRef.current) return;
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

  // Keep a pending save from being lost when the page unmounts (never after a successful submit).
  useEffect(
    () => () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        if (submittedRef.current) return;
        saveAnswerDraft(storage, { attemptId: attempt.attemptId, answers: answersRef.current, pageIndex: pageRef.current });
      }
    },
    [attempt.attemptId, storage],
  );

  // Reservation end: switch to the expired state at `expiresAt`, warn 5 minutes before.
  // Timers are re-armed when the tab becomes visible (background tabs throttle them).
  useEffect(() => {
    if (phase === "expired") return;
    const expiresAt = Date.parse(attempt.expiresAt);
    const timers: ReturnType<typeof setTimeout>[] = [];
    const arm = () => {
      timers.splice(0).forEach(clearTimeout);
      const left = expiresAt - Date.now();
      setExpiringSoon(left <= EXPIRY_WARNING_MS);
      // An in-flight submit is decided by the server's answer, not by the local clock.
      const expire = () => setPhase((current) => (current === "submitting" ? current : "expired"));
      if (left <= 0) {
        expire();
        return;
      }
      if (left > EXPIRY_WARNING_MS) timers.push(setTimeout(() => setExpiringSoon(true), left - EXPIRY_WARNING_MS));
      timers.push(setTimeout(expire, left));
    };
    arm();
    const onVisible = () => {
      if (document.visibilityState === "visible") arm();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      timers.forEach(clearTimeout);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [attempt.expiresAt, phase]);

  const page = layout.pages[pageIndex] ?? layout.pages[0];
  // Focus follows navigation and validation (after the new page / errors render).
  useEffect(() => {
    const request = focusRequest.current;
    if (!request) return;
    focusRequest.current = null;
    applyFocus(request, page?.blocks[0]?.id);
  }, [page, errors]);

  // Telemetry: start/resume once, then every page's questions as they are shown.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current || !telemetry.isEnabled) return;
    startedRef.current = true;
    recordEvent(restored ? "SURVEY_ATTEMPT_RESUMED" : "SURVEY_ATTEMPT_STARTED");
  }, [recordEvent, restored, telemetry.isEnabled]);

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
  // The barrier the server announced wins; the form-derived one is the fallback.
  const earliestSubmitAt = useMemo(() => {
    const announced = attempt.timeBarrier ? Date.parse(attempt.timeBarrier.earliestSubmitAt) : Number.NaN;
    if (Number.isFinite(announced)) return announced;
    const { requiredSeconds } = computeInternalTimeBarrier({ blocks: form.blocks, metadata: form.metadata });
    return Date.parse(attempt.startedAt) + requiredSeconds * 1000;
  }, [attempt.startedAt, attempt.timeBarrier, form]);

  const blockUntil = useCallback((until: number) => {
    const current = Date.now();
    setNow(current);
    setBarrierUntil(until);
    setBarrierStartSeconds(Math.max(1, Math.ceil((until - current) / 1000)));
  }, []);

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
      focusRequest.current = { kind: "page" };
      pageRef.current = target;
      setPageIndex(target);
      setFurthestPage((current) => Math.max(current, target));
      setSubmitError(null);
      saveNow();
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [lastPage, saveNow],
  );

  const showErrors = useCallback(
    (found: Record<string, string>) => {
      setErrors(found);
      const first = Object.keys(found)[0];
      if (!first) return;
      focusRequest.current = { kind: "invalid", blockId: first };
      // Telemetry only for questions of this form (never for server keys like `_errors`).
      for (const id of Object.keys(found)) if (blockIds.has(id)) recordEvent("QUESTION_SKIPPED", id);
    },
    [blockIds, recordEvent],
  );

  // File uploads live here, not in the question cards: paging never loses them (Phase 7).
  const setFiles = useCallback(
    (block: FileUploadBlock, files: FileAttachmentAnswer[], options?: { immediate?: boolean }) => {
      setAnswer(block, files);
      // A removed file must not come back from a stale draft.
      if (options?.immediate) saveNow();
    },
    [saveNow, setAnswer],
  );
  const getAnswer = useCallback((blockId: string) => answersRef.current[blockId], []);
  const uploads = useFileUploads(attempt.attemptId, getAnswer, setFiles);
  const { isBusy: isUploading } = uploads;

  // "Đang tải lên" errors are hidden once that question's upload settled.
  const busyKey = form.blocks.filter((block) => isUploading(block.id)).map((block) => block.id).join(",");
  const shownErrors = useMemo(() => {
    const busy = new Set(busyKey ? busyKey.split(",") : []);
    const stale = Object.keys(errors).filter((id) => errors[id] === UPLOAD_IN_PROGRESS && !busy.has(id));
    if (stale.length === 0) return errors;
    const rest = { ...errors };
    for (const id of stale) delete rest[id];
    return rest;
  }, [busyKey, errors]);

  /** Validation errors, plus "still uploading" for file questions whose upload has not settled. */
  const blockErrors = useCallback(
    (blocks: readonly FormBlock[]) => {
      const found = validateBlocks(blocks, answersRef.current);
      for (const block of blocks) {
        if (isUploading(block.id)) found[block.id] = UPLOAD_IN_PROGRESS;
      }
      return found;
    },
    [isUploading],
  );

  /** Leaving a page (or the attempt) waits for its uploads and deletes: true when it was blocked. */
  const blockedByUploads = useCallback(
    (blocks: readonly FormBlock[]) => {
      const busy = blocks.filter((block) => isUploading(block.id));
      if (busy.length === 0) return false;
      showErrors(Object.fromEntries(busy.map((block) => [block.id, UPLOAD_IN_PROGRESS])));
      return true;
    },
    [isUploading, showErrors],
  );

  const next = useCallback(() => {
    if (!page) return;
    const found = blockErrors(page.blocks);
    if (Object.keys(found).length > 0) {
      showErrors(found);
      return;
    }
    setErrors({});
    goToPage(pageIndex + 1);
  }, [blockErrors, goToPage, page, pageIndex, showErrors]);

  const back = useCallback(() => {
    if (page && blockedByUploads(page.blocks)) return;
    for (const block of layout.pages[pageIndex - 1]?.blocks ?? []) recordEvent("QUESTION_RETURNED", block.id);
    goToPage(pageIndex - 1);
  }, [blockedByUploads, goToPage, layout.pages, page, pageIndex, recordEvent]);

  const jumpToSection = useCallback(
    (sectionIndex: number) => {
      const section = layout.sections[sectionIndex];
      if (!section || (page && blockedByUploads(page.blocks))) return;
      goToPage(section.firstPage);
    },
    [blockedByUploads, goToPage, layout.sections, page],
  );

  const saveAndExit = useCallback(() => {
    if (busyRef.current) return;
    if (blockedByUploads(form.blocks)) {
      const target = firstPageWith(layout, form.blocks.filter((block) => isUploading(block.id)).map((block) => block.id));
      if (target >= 0 && target !== pageIndex) goToPage(target);
      return;
    }
    saveNow();
    void flushQueue();
    router.push("/marketplace");
  }, [blockedByUploads, flushQueue, form.blocks, goToPage, isUploading, layout, pageIndex, router, saveNow]);

  const submit = useCallback(async () => {
    if (busyRef.current) return;
    const all = blockErrors(form.blocks);
    if (Object.keys(all).length > 0) {
      const target = firstPageWith(layout, Object.keys(all));
      if (target >= 0 && target !== pageIndex) goToPage(target);
      showErrors(all);
      setPhase("answering");
      return;
    }
    if (Date.now() < earliestSubmitAt) {
      recordEvent("TIME_BARRIER_TRIGGERED");
      blockUntil(earliestSubmitAt);
      return;
    }
    if (!attempt.responseId) {
      setSubmitError("Không tìm thấy lượt làm này. Hãy mở lại khảo sát từ trang Khám phá.");
      return;
    }

    saveNow();
    busyRef.current = true;
    setSubmitError(null);
    setPhase("submitting");
    try {
      const result = await submitSurveyResponse(attempt.responseId, {
        attemptId: attempt.attemptId,
        answers: toSubmissionAnswers(form.blocks, answersRef.current),
      });
      // From here on nothing may write the draft back (autosave timer, unmount).
      submittedRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = null;
      recordEvent("SURVEY_SUBMITTED");
      void flushQueue();
      stashSubmission(result);
      clearAnswerDraft(storage, attempt.attemptId);
      refresh();
      router.replace(`/attempts/${attempt.attemptId}/complete`);
      return; // stay busy until the completion screen mounts
    } catch (cause) {
      busyRef.current = false;
      // Session ended: keep the local draft and let SessionGate send the user to login.
      if (isSessionLost(cause)) {
        saveNow();
        setOfflineRetry(false);
        setPhase("answering");
        refresh();
        return;
      }
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
        submittedRef.current = true;
        clearAnswerDraft(storage, attempt.attemptId);
        router.replace(`/attempts/${attempt.attemptId}/complete`);
        return;
      }
      setPhase("answering");
      const remaining = timeBarrierRemainingSeconds(cause);
      if (remaining !== null) {
        recordEvent("TIME_BARRIER_TRIGGERED");
        blockUntil(Date.now() + remaining * 1000);
        return;
      }
      // A file the server could not attach: drop it from the answer and say which one.
      const unclean = uncleanAttachmentFiles(cause).filter((file) => blockIds.has(file.questionId));
      if (unclean.length > 0) {
        const marked: Record<string, string> = {};
        for (const { questionId, objectId } of unclean) {
          const block = form.blocks.find((candidate) => candidate.id === questionId);
          const files = answersRef.current[questionId];
          if (!block || !isFileAttachmentList(files)) continue;
          const name = files.find((file) => file.objectId === objectId)?.fileName ?? "đã chọn";
          setAnswer(block, files.filter((file) => file.objectId !== objectId));
          marked[questionId] = `Tệp “${name}” chưa được xác minh an toàn hoặc đã bị xoá. Hãy tải lại tệp rồi nộp bài.`;
        }
        saveNow();
        const target = firstPageWith(layout, Object.keys(marked));
        if (target >= 0) goToPage(target);
        showErrors(marked);
      }
      const invalid = invalidBlockIds(cause, blockIds);
      if (invalid.length > 0) {
        const target = firstPageWith(layout, invalid);
        if (target >= 0) goToPage(target);
        showErrors(Object.fromEntries(invalid.map((id) => [id, "Câu trả lời chưa hợp lệ, hãy kiểm tra lại."])));
      }
      setSubmitError(submitSurveyErrorMessage(cause));
    }
  }, [
    attempt,
    blockErrors,
    blockIds,
    blockUntil,
    earliestSubmitAt,
    flushQueue,
    form.blocks,
    goToPage,
    layout,
    pageIndex,
    recordEvent,
    refresh,
    router,
    saveNow,
    setAnswer,
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
    errors: shownErrors,
    phase,
    /** Figma 4b: the last submit failed without a response (kept during the retry). */
    showOffline: phase === "offline" || (phase === "submitting" && offlineRetry),
    submitError,
    savedAt,
    answeredCount: countAnswered(form.blocks, answers),
    barrierSeconds,
    barrierStartSeconds,
    /** ASSUMED: the reservation ends within `EXPIRY_WARNING_MS`. */
    expiringSoon,
    setAnswer,
    /** Upload state and actions of one `file_upload` question. */
    uploadControls: uploads.controlsFor,
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
