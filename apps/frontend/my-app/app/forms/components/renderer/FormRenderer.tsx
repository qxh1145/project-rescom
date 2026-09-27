"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  FormBlock,
  FormIntegrityMetadata,
  FormSettings,
  IntegrityEventType,
} from "@rescom/schemas";
import { RespondentBlockRenderer } from "./RespondentBlockRenderer";
import {
  validateAllAnswers,
  calculateFormProgress,
  createMockSubmission,
} from "./form-parser";
import { useSurveyOfflineCache } from "../../hooks/useSurveyOfflineCache";
import { useSurveyTelemetry } from "../../hooks/useSurveyTelemetry";
import {
  createQuestionTelemetryController,
  isTextEntryElement,
  markQuestionShown,
} from "../../hooks/telemetry-buffer.mjs";
import { OfflineBanner } from "../OfflineBanner";


function stableBlockHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface FormRendererProps {
  formId?: string;
  attemptId?: string;
  responseId?: string | null;
  formVersionId?: string;
  title: string;
  description?: string;
  rewardPerResponse?: number;
  blocks: FormBlock[];
  settings?: FormSettings;
  metadata?: FormIntegrityMetadata;
  isPreviewMode?: boolean;
  isGuestMode?: boolean;
  renderBeforeSubmit?: React.ReactNode;
  onExitPreview?: () => void;
  onSubmitResponse?: (answers: Record<string, unknown>) => Promise<void>;
  /**
   * Story 8.2: lets the host page present a submit rejection itself (e.g. the
   * Time Barrier countdown). Return true when handled; answers are kept.
   */
  onSubmitError?: (error: unknown) => boolean;
}

export function FormRenderer({
  formId = "preview-form",
  attemptId,
  responseId,
  formVersionId,
  title,
  description,
  rewardPerResponse = 10,
  blocks,
  settings,
  metadata,
  isPreviewMode = true,
  isGuestMode = false,
  renderBeforeSubmit,
  onExitPreview,
  onSubmitResponse,
  onSubmitError,
}: FormRendererProps) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submissionTime, setSubmissionTime] = useState<string | null>(null);

  // Epic 5 review P5: a stable callback — an inline one re-ran the restore
  // effect on every render (perpetual re-render loop once a draft existed).
  const handleAnswersLoaded = useCallback(
    (restored: Record<string, unknown>) => {
      setAnswers((prev) => ({ ...restored, ...prev }));
    },
    [],
  );

  const offlineCache = useSurveyOfflineCache({
    attemptId: isPreviewMode ? undefined : attemptId,
    onAnswersLoaded: handleAnswersLoaded,
  });

  const telemetry = useSurveyTelemetry({
    formId,
    attemptId,
    responseId,
    formVersionId,
    enabled: !isPreviewMode,
  });
  const telemetryEnabled = telemetry.isEnabled;

  // Epic 5 review P13: question view / focus / blur / answer telemetry.
  // Timer-driven emissions go through a ref so they use the latest recorder.
  const recordEventRef = useRef(telemetry.recordEvent);
  useEffect(() => {
    recordEventRef.current = telemetry.recordEvent;
  });
  const questionTelemetryRef = useRef<ReturnType<
    typeof createQuestionTelemetryController
  > | null>(null);
  useEffect(() => {
    const controller = createQuestionTelemetryController({
      emit: (
        eventType: IntegrityEventType,
        questionId: string,
        metadata?: Record<string, unknown>,
      ) => recordEventRef.current(eventType, questionId, metadata),
    });
    questionTelemetryRef.current = controller;
    return () => {
      controller.dispose();
      if (questionTelemetryRef.current === controller) {
        questionTelemetryRef.current = null;
      }
    };
  }, []);

  const questionsContainerRef = useRef<HTMLDivElement>(null);
  const shownQuestionsRef = useRef<Set<string>>(new Set());


  const showProgressBar = settings?.progressBar !== false;
  const submitText = settings?.submitButtonText || "Submit";
  const renderedBlocks = useMemo(() => {
    if (!settings?.shuffleBlocks) return blocks;
    return [...blocks].sort(
      (left, right) =>
        stableBlockHash(`${formId}:${left.id}`) -
        stableBlockHash(`${formId}:${right.id}`),
    );
  }, [blocks, formId, settings?.shuffleBlocks]);

  const progress = calculateFormProgress(renderedBlocks, answers);

  // QUESTION_SHOWN once per block when it scrolls into view.
  useEffect(() => {
    if (!telemetryEnabled || isSubmitted) return;
    if (typeof IntersectionObserver === "undefined") return;
    const container = questionsContainerRef.current;
    if (!container) return;

    const shown = shownQuestionsRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const questionId = (entry.target as HTMLElement).dataset.questionId;
          observer.unobserve(entry.target);
          if (questionId && markQuestionShown(shown, questionId)) {
            recordEventRef.current("QUESTION_SHOWN", questionId);
          }
        }
      },
      { threshold: 0.25 },
    );
    container
      .querySelectorAll<HTMLElement>("[data-question-id]")
      .forEach((element) => {
        const questionId = element.dataset.questionId;
        if (questionId && !shown.has(questionId)) observer.observe(element);
      });
    return () => observer.disconnect();
  }, [telemetryEnabled, isSubmitted, renderedBlocks]);

  function handleQuestionFocus(questionId: string) {
    if (!telemetryEnabled) return;
    questionTelemetryRef.current?.questionFocused(questionId);
  }

  function handleQuestionBlur(
    questionId: string,
    event: React.FocusEvent<HTMLDivElement>,
  ) {
    if (!telemetryEnabled) return;
    const next = event.relatedTarget;
    const stayingInside =
      next instanceof Node && event.currentTarget.contains(next);
    questionTelemetryRef.current?.questionBlurred(questionId, { stayingInside });
  }

  function handleAnswerChange(block: FormBlock, value: unknown) {
    const blockId = block.id;
    const nextAnswers = {
      ...answers,
      [blockId]: value,
    };
    setAnswers(nextAnswers);
    offlineCache.saveAnswers(nextAnswers);

    // AD-9: no keystroke telemetry — typed answers are committed on blur or
    // after an idle period; metadata carries only `valuePresent`.
    if (telemetryEnabled) {
      questionTelemetryRef.current?.answerChanged(blockId, block.type, value, {
        typing:
          typeof document !== "undefined" &&
          isTextEntryElement(document.activeElement),
      });
    }

    // Clear error on change if existing
    if (errors[blockId]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[blockId];
        return next;
      });
    }

    if (submitError) {
      setSubmitError(null);
    }
  }

  function handleReset() {
    setAnswers({});
    setErrors({});
    setSubmitError(null);
    setIsSubmitted(false);
    setSubmissionTime(null);
    offlineCache.clearDraft();
    questionTelemetryRef.current?.answersCleared();
    telemetry.recordEvent("ANSWER_CLEARED");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setSubmitError(null);
    // Enter-to-submit does not blur the field: commit pending typed answers.
    questionTelemetryRef.current?.flushAnswers();

    // Validate answers against blocks schema
    const validation = validateAllAnswers(renderedBlocks, answers);
    if (!validation.isValid) {
      setErrors(validation.errors);

      // Scroll to first invalid question
      const firstErrorId = Object.keys(validation.errors)[0];
      if (firstErrorId) {
        const el = document.getElementById(`question-${firstErrorId}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      return;
    }

    setIsSubmitting(true);

    try {
      if (isPreviewMode) {
        // Pure in-memory mock completion - ZERO network calls to database
        createMockSubmission(formId, "v1", answers);
        await new Promise((res) => setTimeout(res, 400)); // slight realistic feedback delay
        setIsSubmitted(true);
        setSubmissionTime(
          new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        );
      } else if (onSubmitResponse) {
        await onSubmitResponse(answers);
        offlineCache.clearDraft();
        telemetry.recordEvent("SURVEY_SUBMITTED");
        void telemetry.flushQueue();
        setIsSubmitted(true);
      }
    } catch (err: unknown) {
      if (onSubmitError?.(err)) {
        return;
      }
      console.error("Failed to submit response", err);
      const msg = err instanceof Error ? err.message : "Failed to submit response";
      setSubmitError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }


  // Completion Screen
  if (isSubmitted) {
    return (
      <div className="w-full bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 sm:p-12 shadow-sm text-center">
        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
          </svg>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {isGuestMode ? "Submission Received!" : "Thank you for completing this survey!"}
        </h2>

        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto mb-6">
          {isGuestMode
            ? "Your response has been securely recorded as an anonymous guest submission. No account or sign-in required."
            : "Your feedback is greatly appreciated and helps improve the quality of research on RESCOM."}
        </p>

        {/* Reward points simulation badge or Guest badge */}
        {isGuestMode ? (
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 rounded-full text-emerald-800 dark:text-emerald-300 font-medium text-xs mb-8">
            <span>🛡️</span>
            <span>Anonymous Guest Submission • Zero Points Required</span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-2.5 px-4 py-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-full text-amber-800 dark:text-amber-300 font-medium text-xs mb-8">
            <span>🎁</span>
            <span>Earned: {rewardPerResponse} Points</span>
            {isPreviewMode && (
              <span className="text-amber-600/75 dark:text-amber-400/75 italic">
                (Simulated Preview)
              </span>
            )}
          </div>
        )}

        {/* Preview Mode Guarantee Banner */}
        {isPreviewMode && (
          <div className="p-4 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 text-blue-800 dark:text-blue-300 text-xs max-w-md mx-auto mb-8 text-left">
            <p className="font-semibold flex items-center gap-1.5 mb-1">
              <span>🛡️</span> Zero Database Mutation
            </p>
            <p className="text-blue-700/80 dark:text-blue-300/80 leading-relaxed">
              You are testing in <strong>Live Preview</strong> mode. All answers were validated strictly via the shared Form Definition parser. No database records or point transactions were created.
            </p>
            {submissionTime && (
              <p className="text-[11px] text-blue-600/70 dark:text-blue-400/70 mt-2">
                Simulated response completed at {submissionTime}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleReset}
            className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 font-medium text-sm rounded-xl transition-colors cursor-pointer"
          >
            {isGuestMode ? "Submit Another Response" : "Test Again / Reset Answers"}
          </button>

          {onExitPreview && (
            <button
              type="button"
              onClick={onExitPreview}
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm rounded-xl shadow-sm transition-colors cursor-pointer"
            >
              Back to Editor
            </button>
          )}

          {isGuestMode && (
            <a
              href="/marketplace"
              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-sm rounded-xl shadow-sm transition-colors"
            >
              Explore RESCOM
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-6">
      <OfflineBanner
        isOnline={offlineCache.isOnline}
        wasOffline={offlineCache.wasOffline}
        isRestored={offlineCache.isRestored}
      />

      {/* Survey Header Card */}

      <div className="bg-white dark:bg-gray-900 rounded-3xl border border-gray-200 dark:border-gray-800 p-8 shadow-sm">
        <div className="flex items-center justify-between gap-4 mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-1 rounded-md">
            Survey
          </span>

          <div className="flex items-center gap-2">
            {settings?.requireAuth && (
              <span className="text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-2.5 py-1 rounded-full">
                Auth required
              </span>
            )}
            {metadata?.expectedEffortSeconds && (
              <span className="text-xs font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-2.5 py-1 rounded-full">
                ~{Math.max(1, Math.ceil(metadata.expectedEffortSeconds / 60))} min
              </span>
            )}
            <span className="text-xs font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900/50 px-2.5 py-1 rounded-full">
              +{rewardPerResponse} Points
            </span>
          </div>
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white mb-2">
          {title || "Untitled Survey"}
        </h1>

        {description && (
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            {description}
          </p>
        )}

        {/* Dynamic Progress Bar */}
        {showProgressBar && renderedBlocks.length > 0 && (
          <div className="mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
            <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1.5">
              <span>Progress</span>
              <span>
                {progress.percentage}% completed ({progress.answeredCount}/{renderedBlocks.length})
              </span>
            </div>
            <div className="w-full h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 transition-all duration-300 rounded-full"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Question Blocks List */}
      {renderedBlocks.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-dashed border-gray-300 dark:border-gray-800 p-12 text-center text-gray-400 dark:text-gray-600">
          <p className="text-sm font-medium">This survey currently has no questions.</p>
          <p className="text-xs mt-1">
            Switch back to the editor to add questions from the toolbox.
          </p>
        </div>
      ) : (
        <div ref={questionsContainerRef} className="space-y-4">
          {renderedBlocks.map((block, index) => (
            <div
              key={block.id}
              data-question-id={block.id}
              onFocusCapture={() => handleQuestionFocus(block.id)}
              onBlurCapture={(event) => handleQuestionBlur(block.id, event)}
            >
              <RespondentBlockRenderer
                block={block}
                index={index}
                value={answers[block.id]}
                onChange={(val) => handleAnswerChange(block, val)}
                error={errors[block.id]}
                disabled={isSubmitting}
                attemptId={attemptId}
              />
            </div>
          ))}
        </div>
      )}

      {/* Global Validation Error Summary */}
      {Object.keys(errors).length > 0 && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-400 text-xs">
          <p className="font-semibold mb-1">
            Please resolve the {Object.keys(errors).length} highlighted question
            {Object.keys(errors).length > 1 ? "s" : ""} before submitting:
          </p>
          <ul className="list-disc list-inside space-y-0.5">
            {Object.entries(errors).map(([blockId, errMsg]) => {
              const blk = renderedBlocks.find((b) => b.id === blockId);
              return (
                <li key={blockId}>
                  <strong>{blk?.title || "Question"}:</strong> {errMsg}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Form Submission Bar */}
      {renderedBlocks.length > 0 && (
        <div className="pt-4 space-y-4">
          {renderBeforeSubmit}

          {submitError && (
            <div className="p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-2xl text-red-700 dark:text-red-300 text-xs flex items-start gap-2.5 animate-in fade-in">
              <span className="text-base shrink-0">⚠️</span>
              <div>
                <p className="font-semibold">Submission Failed</p>
                <p className="mt-0.5">{submitError}</p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={handleReset}
              disabled={isSubmitting || Object.keys(answers).length === 0}
              className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 disabled:opacity-40 transition-colors cursor-pointer"
            >
              Clear answers
            </button>

            <button
              type="submit"
              disabled={isSubmitting || !offlineCache.isOnline}
              className="inline-flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 dark:disabled:bg-gray-700 text-white font-medium text-sm rounded-xl shadow-sm transition-all focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
            >
              {!offlineCache.isOnline ? (
                <span>Offline (Waiting for Connection...)</span>
              ) : isSubmitting ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Validating...</span>
                </>
              ) : (
                <span>{submitText}</span>
              )}
            </button>

          </div>
        </div>
      )}
    </form>
  );
}
