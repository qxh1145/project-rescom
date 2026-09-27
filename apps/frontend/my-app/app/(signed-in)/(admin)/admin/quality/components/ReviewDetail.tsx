"use client";

import { useId, useState, type ReactNode } from "react";
import { Tag } from "@/components/ui/Tag";
import type { QualityDecisionCommand, QualityReview } from "@/lib/admin/quality-service";
import {
  confidenceLabel,
  coverageText,
  reasonText,
  respondentContextText,
  surveyQualityText,
} from "@/lib/admin/quality-view";
import { formatShortDateTime } from "@/lib/format/date-time";
import { DecisionForm } from "./DecisionForm";

interface ReviewDetailProps {
  review: QualityReview;
  onDecide: (review: QualityReview, command: QualityDecisionCommand) => Promise<unknown>;
}

/** Figma 63:3344 "Section – Chi tiết câu trả lời". */
export function ReviewDetail({ review, onDecide }: ReviewDetailProps) {
  const [answersOpen, setAnswersOpen] = useState(false);
  const answersId = useId();

  return (
    <section
      aria-labelledby="quality-review-title"
      className="rounded-[22px] border border-line bg-surface px-5 pt-6 pb-7 lg:px-7"
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto min-w-0">
          <h2 id="quality-review-title" className="text-title-sm font-extrabold text-ink">
            Câu trả lời #{review.reference}
          </h2>
          <p className="mt-2 text-body-sm text-ink-muted">
            {review.surveyTitle} · form v{review.formVersionNumber} · nộp {formatShortDateTime(review.submittedAt)}
          </p>
        </div>
        <Tag tone="amber" size="md">
          Đang giữ {review.heldPoints} điểm
        </Tag>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Điểm chất lượng" value={`${review.qualityScore} / 100`} fill={review.qualityScore / 100} />
        <Metric label="Độ chắc chắn" value={confidenceLabel(review.confidence)} />
        <Metric label="Độ phủ dữ liệu" value={coverageText(review.coverage)} fill={review.coverage} />
        <Metric label="Chính sách" value={review.policyVersion} />
      </dl>

      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="text-body font-extrabold text-ink">Lý do</h3>
          <ul className="mt-2">
            {review.reasons.map((reason) => (
              <li key={reason.code} className="border-t border-line-subtle pt-2 pb-2.5">
                <p className="font-mono text-[12px] font-bold text-ink-strong">{reason.code}</p>
                <p className="mt-0.5 text-body-sm text-ink">{reasonText(reason)}</p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-body font-extrabold text-ink">Bối cảnh</h3>
          <ul className="mt-2">
            <ContextItem label="Người trả lời">{respondentContextText(review.respondent)}</ContextItem>
            <ContextItem label="Khảo sát">{surveyQualityText(review.surveyQuality)}</ContextItem>
            <ContextItem label="Câu trả lời">
              {review.answers.length > 0 ? (
                <button
                  type="button"
                  aria-expanded={answersOpen}
                  aria-controls={answersId}
                  onClick={() => setAnswersOpen((open) => !open)}
                  className="font-bold text-primary hover:underline"
                >
                  {answersOpen ? "Ẩn câu trả lời" : `Xem đủ ${review.answers.length} câu trả lời`}
                </button>
              ) : (
                "Không có nội dung câu trả lời"
              )}
            </ContextItem>
          </ul>
        </div>
      </div>

      {answersOpen ? (
        // ASSUMED (not drawn): the answers open inline under the context.
        <ol id={answersId} className="mt-3 flex flex-col gap-2 rounded-[14px] bg-surface-muted px-4 py-3">
          {review.answers.map((answer, index) => (
            <li key={`${index}-${answer.question}`} className="text-body-sm">
              <p className="font-semibold text-ink-strong">
                Câu {index + 1}. {answer.question}
              </p>
              <p className="text-ink">{answer.answer}</p>
            </li>
          ))}
        </ol>
      ) : null}

      <DecisionForm review={review} onDecide={onDecide} />
    </section>
  );
}

function Metric({ label, value, fill }: { label: string; value: string; fill?: number }) {
  return (
    <div className="flex min-h-20.5 flex-col rounded-[14px] bg-surface-muted px-3.5 pt-3 pb-3">
      <dt className="text-[12px] font-semibold text-ink-muted">{label}</dt>
      <dd className="mt-1.5 text-[20px] font-extrabold text-ink">{value}</dd>
      {fill !== undefined ? (
        <div aria-hidden="true" className="mt-auto h-1.5 overflow-hidden rounded-[3px] bg-line">
          <div className="h-full rounded-[3px] bg-ink" style={{ width: `${Math.round(Math.min(1, Math.max(0, fill)) * 100)}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function ContextItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="border-t border-line-subtle pt-2.5 pb-2.5">
      <p className="text-[12px] font-bold text-ink-strong">{label}</p>
      <div className="mt-0.5 text-body-sm text-ink">{children}</div>
    </li>
  );
}
