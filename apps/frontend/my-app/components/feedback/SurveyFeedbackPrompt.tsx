"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  SURVEY_FEEDBACK_COMMENT_MAX_LENGTH,
  SURVEY_FEEDBACK_ISSUE_TAGS,
  SURVEY_FEEDBACK_RATING_MAX,
  type SurveyFeedbackDto,
  type SurveyFeedbackIssueTag,
} from "@rescom/schemas";
import { mockRepository } from "@/lib/mock/repository.ts";
import {
  resolveSurveyFeedbackFailure,
  SURVEY_FEEDBACK_THANK_YOU_NOTE,
} from "@/lib/survey-feedback.ts";

const RATING_VALUES = Array.from(
  { length: SURVEY_FEEDBACK_RATING_MAX },
  (_, index) => index + 1,
);

const RATING_LABELS: Record<number, string> = {
  1: "Rất tệ",
  2: "Tệ",
  3: "Bình thường",
  4: "Tốt",
  5: "Rất tốt",
};

const ISSUE_TAG_LABELS: Record<SurveyFeedbackIssueTag, string> = {
  UNCLEAR_QUESTIONS: "Câu hỏi khó hiểu",
  LONGER_THAN_ESTIMATED: "Dài hơn thời gian ước tính",
  MISLEADING_DESCRIPTION: "Mô tả không đúng nội dung",
  TECHNICAL_ISSUE: "Gặp lỗi kỹ thuật",
};

type Phase = "loading" | "hidden" | "load-error" | "form" | "skipped" | "submitted";
type FocusTarget = "form" | "reopen" | "thanks" | null;

function StarIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path
        d="M12 2.8l2.8 5.9 6.4.8-4.7 4.5 1.2 6.4L12 17.2l-5.7 3.2 1.2-6.4-4.7-4.5 6.4-.8L12 2.8z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

interface SurveyFeedbackPromptProps {
  attemptId: string;
  surveyTitle?: string;
}

/**
 * Post-completion feedback prompt (Story 9.2, FR-43): a 5-star rating
 * (native radio group), optional issue chips and an optional plain-text
 * comment, shown right in the success receipt. Optional and reward-neutral;
 * eligibility, validation and one-per-attempt rules live in the repository.
 */
export function SurveyFeedbackPrompt({ attemptId, surveyTitle }: SurveyFeedbackPromptProps) {
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const commentId = `${baseId}-comment`;
  const counterId = `${baseId}-counter`;

  const [phase, setPhase] = useState<Phase>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [rating, setRating] = useState<number | null>(null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [issueTags, setIssueTags] = useState<SurveyFeedbackIssueTag[]>([]);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<SurveyFeedbackDto | null>(null);

  // Element to focus once the prompt has re-rendered in its new shape.
  const pendingFocusRef = useRef<FocusTarget>(null);
  const starRefs = useRef<Array<HTMLInputElement | null>>([]);
  const reopenRef = useRef<HTMLButtonElement>(null);
  const thanksRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;

    async function loadStatus() {
      try {
        const status = await mockRepository.getSurveyFeedbackStatus(attemptId);
        if (!active) return;
        if (status.state === "SUBMITTED" && status.feedback) {
          setSubmitted(status.feedback);
          setPhase("submitted");
        } else {
          setPhase(status.state === "ELIGIBLE" ? "form" : "hidden");
        }
      } catch (err: unknown) {
        if (!active) return;
        // Unknown/foreign attempt or signed out: a retry can never help.
        setPhase(resolveSurveyFeedbackFailure(err) === "RETRY" ? "load-error" : "hidden");
      }
    }

    void loadStatus();
    return () => {
      active = false;
    };
  }, [attemptId, reloadKey]);

  // Keeps keyboard focus on a sensible element when the prompt changes shape.
  useEffect(() => {
    const target = pendingFocusRef.current;
    if (!target) return;
    pendingFocusRef.current = null;
    if (target === "form") {
      // Radio-group convention: focus the checked star, else the first one.
      const index = rating === null ? 0 : rating - 1;
      starRefs.current[index]?.focus();
    }
    if (target === "reopen") reopenRef.current?.focus();
    if (target === "thanks") thanksRef.current?.focus();
  }, [phase, rating]);

  function toggleIssueTag(tag: SurveyFeedbackIssueTag) {
    setIssueTags((current) =>
      current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag],
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (rating === null || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await mockRepository.submitSurveyFeedback(attemptId, {
        rating,
        comment,
        issueTags,
      });
      setSubmitted(result.feedback);
      pendingFocusRef.current = "thanks";
      setPhase("submitted");
    } catch (err: unknown) {
      const failure = resolveSurveyFeedbackFailure(err);
      if (failure === "SHOW_SUBMITTED") {
        // e.g. already rated from another tab: show the stored feedback.
        setPhase("loading");
        setReloadKey((key) => key + 1);
      } else if (failure === "HIDE") {
        setPhase("hidden");
      } else {
        setError(errorMessage(err, "Không thể gửi đánh giá. Vui lòng thử lại."));
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleSkip() {
    setError(null);
    pendingFocusRef.current = "reopen";
    setPhase("skipped");
  }

  function handleReopen() {
    pendingFocusRef.current = "form";
    setPhase("form");
  }

  if (phase === "hidden") return null;

  const shellClass =
    "mb-6 text-left rounded-2xl border p-4 sm:p-5";

  if (phase === "loading") {
    return (
      <div className={`${shellClass} border-slate-200 dark:border-slate-800`}>
        <span className="sr-only" role="status">
          Đang tải phần đánh giá khảo sát...
        </span>
        <div aria-hidden="true" className="motion-safe:animate-pulse space-y-3">
          <div className="h-3 w-2/3 rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-8 w-48 rounded bg-slate-200 dark:bg-slate-800" />
        </div>
      </div>
    );
  }

  if (phase === "load-error") {
    return (
      <div
        className={`${shellClass} border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400`}
      >
        <p role="alert">Không tải được phần đánh giá khảo sát.</p>
        <button
          type="button"
          onClick={() => {
            setPhase("loading");
            setReloadKey((key) => key + 1);
          }}
          className="mt-2 font-bold text-emerald-700 dark:text-emerald-400 underline rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 cursor-pointer"
        >
          Thử lại
        </button>
      </div>
    );
  }

  if (phase === "submitted" && submitted) {
    return (
      <section
        aria-labelledby={headingId}
        className={`${shellClass} border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30`}
      >
        <div role="status">
          <h3
            id={headingId}
            ref={thanksRef}
            tabIndex={-1}
            className="text-sm font-black text-emerald-900 dark:text-emerald-200 rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          >
            Cảm ơn bạn đã đánh giá!
          </h3>
          <div
            className="mt-2 flex items-center gap-0.5 text-amber-500"
            role="img"
            aria-label={`Bạn đã chấm ${submitted.rating}/${SURVEY_FEEDBACK_RATING_MAX} sao – ${RATING_LABELS[submitted.rating]}`}
          >
            {RATING_VALUES.map((value) => (
              <StarIcon
                key={value}
                filled={value <= submitted.rating}
                className={`w-5 h-5 ${value <= submitted.rating ? "" : "text-slate-400 dark:text-slate-500"}`}
              />
            ))}
            <span aria-hidden="true" className="ml-2 text-xs font-bold text-slate-700 dark:text-slate-300">
              {RATING_LABELS[submitted.rating]}
            </span>
          </div>
          {submitted.issueTags.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Vấn đề bạn đã báo">
              {submitted.issueTags.map((tag) => (
                <li
                  key={tag}
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900 text-slate-700 dark:text-slate-300"
                >
                  {ISSUE_TAG_LABELS[tag]}
                </li>
              ))}
            </ul>
          )}
          {submitted.comment && (
            // Plain text only: React escapes it; never rendered as HTML.
            <p className="mt-2 text-xs text-slate-700 dark:text-slate-300 whitespace-pre-line break-words">
              “{submitted.comment}”
            </p>
          )}
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
            {SURVEY_FEEDBACK_THANK_YOU_NOTE}
          </p>
        </div>
      </section>
    );
  }

  if (phase === "skipped") {
    return (
      <div
        className={`${shellClass} border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-x-2 gap-y-1`}
      >
        <span>Bạn đã bỏ qua phần đánh giá khảo sát.</span>
        <button
          type="button"
          ref={reopenRef}
          onClick={handleReopen}
          className="font-bold text-emerald-700 dark:text-emerald-400 underline rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 cursor-pointer"
        >
          Đánh giá ngay
        </button>
      </div>
    );
  }

  const shownRating = hoverRating ?? rating;

  return (
    <section
      aria-labelledby={headingId}
      className={`${shellClass} border-amber-200 dark:border-amber-900/70 bg-amber-50/50 dark:bg-amber-950/20`}
    >
      <h3 id={headingId} className="text-sm font-black text-slate-900 dark:text-white">
        Bạn thấy khảo sát này thế nào?
      </h3>
      <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
        {surveyTitle ? (
          <>
            Đánh giá nhanh <strong className="text-slate-800 dark:text-slate-200">{surveyTitle}</strong>{" "}
          </>
        ) : (
          "Đánh giá nhanh khảo sát vừa hoàn thành "
        )}
        để góp phần nâng cao chất lượng khảo sát trên RESCOM. Hoàn toàn tự nguyện và không ảnh hưởng đến điểm thưởng của bạn.
      </p>

      <form onSubmit={handleSubmit} className="mt-3 space-y-4" noValidate>
        <fieldset disabled={submitting}>
          <legend className="text-xs font-bold text-slate-800 dark:text-slate-200">
            Chấm điểm tổng thể <span className="text-rose-600" aria-hidden="true">*</span>
            <span className="sr-only">(bắt buộc để gửi đánh giá)</span>
          </legend>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-2">
            <div
              className="flex items-center"
              onMouseLeave={() => setHoverRating(null)}
            >
              {RATING_VALUES.map((value) => {
                const inputId = `${baseId}-star-${value}`;
                const filled = shownRating !== null && value <= shownRating;
                return (
                  <label
                    key={value}
                    htmlFor={inputId}
                    onMouseEnter={() => setHoverRating(value)}
                    className="relative cursor-pointer"
                  >
                    <input
                      ref={(element) => {
                        starRefs.current[value - 1] = element;
                      }}
                      id={inputId}
                      type="radio"
                      name={`${baseId}-rating`}
                      value={value}
                      checked={rating === value}
                      onChange={() => setRating(value)}
                      className="peer sr-only"
                    />
                    <span className="sr-only">
                      {value} sao – {RATING_LABELS[value]}
                    </span>
                    <span
                      className={`block p-1.5 rounded-lg motion-safe:transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-amber-600 ${
                        filled
                          ? "text-amber-500"
                          : "text-slate-400 dark:text-slate-500 hover:text-amber-500"
                      }`}
                    >
                      <StarIcon filled={filled} className="w-7 h-7" />
                    </span>
                  </label>
                );
              })}
            </div>
            <span
              aria-hidden="true"
              className="ml-1 text-xs font-bold text-slate-700 dark:text-slate-300 min-w-[5.5rem]"
            >
              {shownRating ? RATING_LABELS[shownRating] : "Chọn số sao"}
            </span>
          </div>
        </fieldset>

        <fieldset disabled={submitting}>
          <legend className="text-xs font-bold text-slate-800 dark:text-slate-200">
            Bạn có gặp vấn đề nào không?{" "}
            <span className="font-normal text-slate-500 dark:text-slate-400">(không bắt buộc)</span>
          </legend>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {SURVEY_FEEDBACK_ISSUE_TAGS.map((tag) => {
              const checked = issueTags.includes(tag);
              return (
                <label key={tag} className="relative cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleIssueTag(tag)}
                    className="peer sr-only"
                  />
                  <span
                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full border text-[11px] font-semibold motion-safe:transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-amber-600 ${
                      checked
                        ? "bg-amber-100 dark:bg-amber-900/40 border-amber-400 dark:border-amber-700 text-amber-900 dark:text-amber-100"
                        : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-amber-300"
                    }`}
                  >
                    {checked && <span aria-hidden="true">✓</span>}
                    {ISSUE_TAG_LABELS[tag]}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div>
          <label
            htmlFor={commentId}
            className="block text-xs font-bold text-slate-800 dark:text-slate-200"
          >
            Nhận xét thêm{" "}
            <span className="font-normal text-slate-500 dark:text-slate-400">(không bắt buộc)</span>
          </label>
          <textarea
            id={commentId}
            rows={3}
            value={comment}
            maxLength={SURVEY_FEEDBACK_COMMENT_MAX_LENGTH}
            disabled={submitting}
            aria-describedby={counterId}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Ví dụ: Câu 3 hơi khó hiểu, khảo sát dài hơn mô tả..."
            className="mt-1.5 w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500 disabled:opacity-60"
          />
          <p id={counterId} className="mt-1 text-right text-[11px] text-slate-500 dark:text-slate-400">
            {comment.length}/{SURVEY_FEEDBACK_COMMENT_MAX_LENGTH} ký tự
          </p>
        </div>

        {error && (
          <p role="alert" className="text-xs font-medium text-rose-600 dark:text-rose-400">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={rating === null || submitting}
            className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-amber-700 hover:bg-amber-800 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm motion-safe:transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-600 inline-flex items-center gap-2"
          >
            {submitting ? (
              <>
                <span
                  aria-hidden="true"
                  className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full motion-safe:animate-spin"
                />
                <span>Đang gửi đánh giá...</span>
              </>
            ) : (
              <span>Gửi đánh giá</span>
            )}
          </button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={submitting}
            className="px-3 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:opacity-50"
          >
            Bỏ qua
          </button>
        </div>
      </form>
    </section>
  );
}
