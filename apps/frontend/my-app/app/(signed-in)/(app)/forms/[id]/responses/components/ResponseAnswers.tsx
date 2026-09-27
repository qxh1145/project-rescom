import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { reviewReasonText } from "@/lib/forms/results-messages";
import type { FormResponse, FormResponses, ResultQuestion } from "@/lib/forms/results-service";
import {
  answerChoices,
  answerText,
  formatDurationLong,
  formatSubmittedAt,
  questionKindLabel,
} from "@/lib/forms/results-view";
import { QualityTag } from "./QualityTag";

type Variant = "panel" | "page";

/** "Nộp 18/09 16:48 · 6 phút 02 giây" + quality pill (+ ASSUMED reason line for "Cần xem lại"). */
export function ResponseMeta({ response, variant }: { response: FormResponse; variant: Variant }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-ink-muted">
        <QualityTag quality={response.quality} withCheck={variant === "page"} />
        <span>Nộp {formatSubmittedAt(response.submittedAt)}</span>
        <span aria-hidden="true">·</span>
        <span>{formatDurationLong(response.durationSeconds)}</span>
      </div>
      {response.quality === "NEEDS_REVIEW" && response.reviewReasons.length ? (
        <p className="text-caption text-tone-amber-fg">
          Gợi ý kiểm tra: {response.reviewReasons.map(reviewReasonText).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

function questionHeading(question: ResultQuestion, variant: Variant): string {
  const kind = questionKindLabel(question);
  const prefix = variant === "page" ? `Câu ${question.number}` : `C${question.number}`;
  return `${prefix} · ${question.title}${kind ? ` · ${kind}` : ""}`;
}

function AnswerValueView({ question, response, variant }: { question: ResultQuestion; response: FormResponse; variant: Variant }) {
  const value = response.answers[question.id];
  const page = variant === "page";
  if (question.type === "multiple_choice") {
    const choices = answerChoices(question, value);
    if (!choices.length) return <p className="text-body text-ink-muted">Không trả lời</p>;
    return (
      <ul className={`flex flex-wrap gap-1.5 ${page ? "mt-1" : ""}`}>
        {choices.map((choice) => (
          <li
            key={choice}
            className={`inline-flex items-center rounded-full bg-surface-subtle font-semibold text-ink ${
              page ? "h-7.5 px-3 text-[14px]" : "h-7 px-2.5 text-[13px]"
            }`}
          >
            {choice}
          </li>
        ))}
      </ul>
    );
  }
  const text = answerText(question, value);
  if (!text) return <p className="text-body text-ink-muted">Không trả lời</p>;
  const free = question.type === "text" || question.type === "textarea";
  return (
    <p
      className={[
        "text-ink",
        page ? "text-[16px] leading-[23.2px]" : "text-[15px]",
        free ? `font-normal ${page ? "" : "leading-[22.5px]"} whitespace-pre-line` : "font-semibold",
      ].join(" ")}
    >
      {text}
    </p>
  );
}

/** Every answer of one response (10d aside "Câu trả lời #47AD", 10d' "Nội dung câu trả lời"). */
export function ResponseAnswers({
  data,
  response,
  variant,
}: {
  data: FormResponses;
  response: FormResponse;
  variant: Variant;
}) {
  if (data.form.type === "EXTERNAL") {
    return (
      <div className="flex flex-col gap-2 border-t border-line-subtle pt-3 text-body-sm text-ink-strong">
        <p>
          <span className="font-semibold text-ink">Mã hoàn thành:</span>{" "}
          {response.codeVerified ? "đã xác minh trong Rescom" : "chưa xác minh"}
        </p>
        <p>Nội dung câu trả lời nằm trong Google Forms của bạn — Rescom chỉ lưu mã xác minh.</p>
        {data.form.externalUrl ? (
          <a
            href={data.form.externalUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 font-bold text-primary hover:underline"
          >
            Mở Google Forms
            <Icon name="external-link" size={16} />
          </a>
        ) : null}
      </div>
    );
  }
  return (
    <ol className="flex flex-col">
      {data.questions.map((question, index) => (
        <li
          key={question.id}
          className={`flex flex-col ${variant === "page" ? "gap-1.5 py-3" : "gap-1 py-2.5"} ${
            index === 0 && variant === "page" ? "pt-0" : "border-t border-line-subtle"
          }`}
        >
          <p
            className={`text-[12px] font-semibold text-ink-muted ${variant === "page" ? "leading-[17.4px]" : ""}`}
          >
            {questionHeading(question, variant)}
          </p>
          <AnswerValueView question={question} response={response} variant={variant} />
        </li>
      ))}
    </ol>
  );
}

/** ASSUMED entry (not drawn): complaint about one response → 5B's complaints page. */
export function ComplaintLink({ formId, response }: { formId: string; response: FormResponse }) {
  return (
    <Link
      href={`/forms/${formId}/complaints?responseId=${encodeURIComponent(response.id)}`}
      className="inline-flex min-h-11 items-center gap-2 self-start text-label font-bold text-primary hover:underline"
    >
      <Icon name="flag" size={16} />
      Khiếu nại về câu trả lời này
    </Link>
  );
}
