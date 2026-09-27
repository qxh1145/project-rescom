"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { buttonClassName } from "@/components/ui/Button";
import { StarRating } from "@/components/ui/StarRating";
import { Textarea } from "@/components/ui/Textarea";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { SURVEY_FEEDBACK_THANK_YOU_NOTE } from "@/lib/survey-feedback";
import { ISSUE_TAG_LABELS, ISSUE_TAGS, type FeedbackFormState } from "../hooks/use-feedback-form";

export const FEEDBACK_FORM_ID = "survey-feedback-form";

/**
 * Figma 6 "Form" (62:1805 desktop / 62:2085 mobile). The action buttons are
 * rendered by the page (desktop inside the card, mobile in a sticky bar) and
 * submit this form through its id.
 */
export function FeedbackFormCard({
  form,
  surveyTitle,
  actions,
}: {
  form: FeedbackFormState;
  surveyTitle: string;
  /** Desktop buttons, placed at the bottom of the card. */
  actions: ReactNode;
}) {
  return (
    <form
      id={FEEDBACK_FORM_ID}
      aria-labelledby="feedback-title"
      onSubmit={(event) => {
        event.preventDefault();
        void form.submit();
      }}
      className="flex flex-col rounded-[18px] border border-line bg-surface px-[18px] pt-4 pb-5 lg:rounded-card lg:px-8 lg:pt-[30px] lg:pb-[34px]"
    >
      <h2 id="feedback-title" className="text-lead font-extrabold text-ink lg:text-[20px]">
        Khảo sát này thế nào?
      </h2>
      <p className="mt-1 text-caption text-ink-muted lg:mt-[9px] lg:text-body-sm">
        <span className="lg:hidden">Góp ý giúp người đăng làm khảo sát tốt hơn.</span>
        <span className="hidden lg:inline">{surveyTitle}</span>
      </p>

      <div className="mt-[18px] lg:mt-[22px]">
        <div className="lg:hidden">
          <StarRating value={form.rating} onChange={form.setRating} size={32} gap={14} legend="Chấm điểm khảo sát" />
        </div>
        <div className="hidden lg:block">
          <StarRating value={form.rating} onChange={form.setRating} size={40} gap={16} legend="Chấm điểm khảo sát" />
        </div>
      </div>

      <fieldset className="mt-4 lg:mt-6">
        <legend className="sr-only lg:not-sr-only lg:mb-3 lg:text-label lg:font-semibold lg:text-ink">
          Có điểm nào chưa ổn? <span className="font-medium text-ink-muted">(tuỳ chọn)</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {ISSUE_TAGS.map((tag) => (
            <ToggleChip
              key={tag}
              size="sm"
              selected={form.tags.includes(tag)}
              onSelectedChange={(selected) => form.toggleTag(tag, selected)}
            >
              {ISSUE_TAG_LABELS[tag]}
            </ToggleChip>
          ))}
        </div>
      </fieldset>

      <Textarea
        id="feedback-comment"
        label="Nhận xét thêm"
        hint="(không bắt buộc, tối đa 500 ký tự)"
        maxLength={500}
        value={form.comment}
        onChange={(event) => form.setComment(event.target.value)}
        className="mt-3.5 lg:mt-6"
      />

      {form.error ? (
        <Alert tone="danger" className="mt-4">
          {form.error}
        </Alert>
      ) : null}

      <div className="mt-[18px] hidden gap-3 lg:flex">{actions}</div>
    </form>
  );
}

/** ASSUMED (not in Figma): after sending, or when no rating is possible. */
export function FeedbackDoneCard({ sent }: { sent: boolean }) {
  return (
    <section className="flex flex-col gap-3 rounded-[18px] border border-line bg-surface px-[18px] py-5 lg:rounded-card lg:px-8 lg:py-8">
      <h2 className="text-lead font-extrabold text-ink lg:text-[20px]">
        {sent ? "Cảm ơn bạn đã đánh giá!" : "Bạn có thể làm khảo sát tiếp theo"}
      </h2>
      <p className="text-body-sm text-ink-muted">
        {sent ? SURVEY_FEEDBACK_THANK_YOU_NOTE : "Điểm thưởng đã được ghi nhận vào Ví điểm của bạn."}
      </p>
      <div className="mt-2 flex flex-wrap gap-3">
        <Link href="/marketplace" className={buttonClassName({ size: "lg" })}>
          Về Khám phá
        </Link>
        <Link href="/wallet" className={buttonClassName({ variant: "secondary", size: "lg" })}>
          Xem Ví điểm
        </Link>
      </div>
    </section>
  );
}
