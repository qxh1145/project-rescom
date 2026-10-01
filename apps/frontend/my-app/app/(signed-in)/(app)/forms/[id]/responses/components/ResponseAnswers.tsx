import { Icon } from "@/components/ui/Icon";
import { Tag } from "@/components/ui/Tag";
import { NOT_ASSESSED_LABEL } from "@/lib/forms/results-messages";
import type { AvailableFormResponses, FormResponse, ResultQuestion } from "@/lib/forms/results-service";
import {
  answerChoices,
  answerText,
  formatDurationLong,
  formatSubmittedAt,
  questionKindLabel,
} from "@/lib/forms/results-view";

type Variant = "panel" | "page";

/**
 * "Nộp 18/09 16:48 · 6 phút 02 giây" + "Ẩn danh" (publishers only ever see the
 * response code) + the neutral "Chưa đánh giá chất lượng" tag: responses are
 * never graded in Phase 1 (`integrity.applicability` NOT_ASSESSED, IR.4a R8).
 */
export function ResponseMeta({ response }: { response: FormResponse; variant: Variant }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-ink-muted">
        {response.integrity.applicability === "NOT_ASSESSED" ? <Tag tone="neutral">{NOT_ASSESSED_LABEL}</Tag> : null}
        <Tag tone="neutral" icon={<Icon name="lock" size={12} />}>
          Ẩn danh
        </Tag>
        <span>Nộp {formatSubmittedAt(response.submittedAt)}</span>
        <span aria-hidden="true">·</span>
        <span>{formatDurationLong(response.durationSeconds)}</span>
      </div>
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
  data: AvailableFormResponses;
  response: FormResponse;
  variant: Variant;
}) {
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
