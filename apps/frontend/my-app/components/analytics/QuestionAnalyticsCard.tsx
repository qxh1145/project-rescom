import { useId, type ReactNode } from "react";
import type { QuestionAnalytics } from "@/lib/forms/results-analytics-service";
import {
  distributionRows,
  formatAnswerSample,
  formatCount,
  otherBucketLabel,
  questionTypeLabel,
  responsesLabel,
  sharesMayExceed100,
  statItems,
  visualOf,
} from "@/lib/forms/results-analytics";
import { DistributionBarChart } from "./DistributionBarChart";
import { DistributionTable } from "./DistributionTable";
import { DonutChart } from "./DonutChart";
import { StatList } from "./StatList";
import { TextAnswerList } from "./TextAnswerList";

const MULTIPLE_NOTE = "Một người có thể chọn nhiều đáp án: tổng tỷ lệ có thể vượt 100%.";

type Variant = "summary" | "detail";

/** "1 · Không bao giờ" … "10 · Chắc chắn có" under the bars of a scale whose ends are labelled. */
function ScaleEndLabels({ summary }: { summary: QuestionAnalytics["summary"] }) {
  if (summary.kind !== "scale" || (!summary.minLabel && !summary.maxLabel)) return null;
  const end = (point: number, label: string | null) => (label ? `${formatCount(point)} · ${label}` : null);
  return (
    // pl-9 = the Y-axis width, so the labels sit under the first and last bars.
    <div className="mt-1 flex justify-between gap-4 pl-9 text-[12px] leading-4 text-ink-muted">
      <span className="min-w-0 break-words">{end(summary.min, summary.minLabel)}</span>
      <span className="min-w-0 text-right break-words">{end(summary.max, summary.maxLabel)}</span>
    </div>
  );
}

function CardBody({
  question,
  variant,
  textAnswers,
  seeAllHref,
}: {
  question: QuestionAnalytics;
  variant: Variant;
  textAnswers?: ReactNode;
  seeAllHref?: string;
}) {
  const visual = visualOf(question);
  const { summary, answeredCount, title } = question;
  const detail = variant === "detail";

  if (visual === "count-only") {
    return (
      <p className="text-body-sm text-ink">
        <span className="font-bold">{formatCount(answeredCount)}</span> câu trả lời có tệp đính kèm.
      </p>
    );
  }
  if (visual === "text-list") {
    if (textAnswers) return <>{textAnswers}</>;
    const samples = summary.kind === "text" ? summary.samples : [];
    return (
      <TextAnswerList
        answers={samples.map((sample) => ({
          key: sample.responseId,
          value: formatAnswerSample(question.type, sample.value),
          submittedAt: sample.submittedAt,
        }))}
        total={answeredCount}
        moreHref={seeAllHref}
      />
    );
  }
  if (answeredCount === 0) return <p className="text-body-sm text-ink-muted">Chưa có ai trả lời câu này.</p>;

  const rows = distributionRows(question);
  const note = sharesMayExceed100(question) ? MULTIPLE_NOTE : null;
  const other = detail && summary.kind === "choice" && summary.other?.samples.length ? summary.other : null;

  return (
    <div className="flex flex-col gap-5">
      {visual === "donut" ? (
        <div className="grid gap-4 md:grid-cols-[240px_minmax(0,1fr)] md:items-center md:gap-8">
          <div className="flex justify-center">
            <DonutChart rows={rows} total={answeredCount} />
          </div>
          {/* Capped so count and % stay next to the label on wide screens. */}
          <DistributionTable rows={rows} caption={title} variant={variant} showColor note={note} className="w-full max-w-[460px]" />
        </div>
      ) : visual === "bar-horizontal" ? (
        <>
          <div>
            <DistributionBarChart rows={rows} orientation="horizontal" />
            {note ? <p className="mt-3 text-[12px] leading-[18px] text-ink-muted">{note}</p> : null}
          </div>
          {/* The bars already carry label, count and %; the detail view adds the table. */}
          {detail ? <DistributionTable rows={rows} caption={title} variant="detail" /> : null}
        </>
      ) : (
        <>
          <StatList items={statItems(question)} />
          <div>
            <DistributionBarChart rows={rows} orientation="vertical" />
            <ScaleEndLabels summary={summary} />
          </div>
          {/* Narrow bars can drop tick labels and counts: below md the summary shows the compact table too. */}
          <DistributionTable rows={rows} caption={title} variant={variant} className={detail ? "" : "md:sr-only"} />
        </>
      )}
      {other ? (
        <div>
          <h4 className="mb-2 text-caption font-bold text-ink">Câu trả lời “{otherBucketLabel(summary)}”</h4>
          <TextAnswerList answers={other.samples.map((value, index) => ({ key: `other:${index}`, value }))} />
          {other.count > other.samples.length ? (
            <p className="mt-2 text-[12px] leading-[18px] text-ink-muted">
              Hiển thị {formatCount(other.samples.length)} / {formatCount(other.count)} câu trả lời “{otherBucketLabel(summary)}” gần nhất.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One question of the response analytics (Câu trả lời → Tóm tắt / Theo câu
 * hỏi). The visual comes from `visualOf()` — donut, horizontal or vertical
 * bars, answer list or count only — so screens never branch on the type.
 * Props only: reusable on dashboard / admin / public pages.
 */
export function QuestionAnalyticsCard({
  question,
  variant = "summary",
  footer,
  textAnswers,
  seeAllHref,
}: {
  question: QuestionAnalytics;
  /** `summary` = compact legend; `detail` = full table ("Lựa chọn · Số câu trả lời · Tỷ lệ"). */
  variant?: Variant;
  footer?: ReactNode;
  /** Replaces the sample answers of a text / paragraph / date question (e.g. every answer). */
  textAnswers?: ReactNode;
  /** "Xem tất cả N câu trả lời" target of a text / paragraph / date card. */
  seeAllHref?: string;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4 rounded-[22px] border border-line bg-surface p-5 lg:p-6">
      <header className="flex flex-col gap-1">
        <p className="text-[12px] leading-[18px] font-semibold text-ink-muted">
          Câu {question.number} · {questionTypeLabel(question.type)}
        </p>
        <h3 id={titleId} className="text-[16px] leading-[22px] font-extrabold break-words text-ink lg:text-[17px]">
          {question.title}
        </h3>
        <p className="text-caption leading-[18px] text-ink-muted">
          {responsesLabel(question.answeredCount)}
          {question.skippedCount > 0 ? ` · ${formatCount(question.skippedCount)} bỏ qua` : ""}
        </p>
      </header>
      <CardBody question={question} variant={variant} textAnswers={textAnswers} seeAllHref={seeAllHref} />
      {footer}
    </section>
  );
}
