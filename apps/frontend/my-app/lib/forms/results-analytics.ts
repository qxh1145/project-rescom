import type { FormBlockType } from "@rescom/schemas";
import type { FormAnalytics, QuestionAnalytics, QuestionSummary } from "./results-analytics-service.ts";
import { formatDate } from "./results-view.ts";

/**
 * Pure presentation rules of the analytics cards: which visual a question
 * gets, number formatting and the stable option → color mapping. Screens and
 * `components/analytics/*` never branch on a question type themselves.
 */

export type AnalyticsVisual = "donut" | "bar-horizontal" | "bar-vertical" | "text-list" | "count-only";

/** Single choice with more options than this switches from donut to horizontal bars. */
export const DONUT_MAX_OPTIONS = 5;

/** Question type → visual (rules 16 of the brief; RESCOM has no dropdown / yes_no block — a 2-option single_choice is yes/no). */
const VISUAL_OF_TYPE: Record<FormBlockType, (optionCount: number) => AnalyticsVisual> = {
  single_choice: (optionCount) => (optionCount <= DONUT_MAX_OPTIONS ? "donut" : "bar-horizontal"),
  multiple_choice: () => "bar-horizontal",
  rating: () => "bar-vertical",
  linear_scale: () => "bar-vertical",
  number: () => "bar-vertical",
  text: () => "text-list",
  textarea: () => "text-list",
  date: () => "text-list",
  file_upload: () => "count-only",
};

/** Slices/bars drawn for a choice summary: the options plus the "Khác" bucket when it has answers. */
export function choiceSliceCount(summary: QuestionSummary): number {
  if (summary.kind !== "choice") return 0;
  return summary.options.length + (summary.other && summary.other.count > 0 ? 1 : 0);
}

export function visualOf(question: Pick<QuestionAnalytics, "type" | "summary">): AnalyticsVisual {
  return VISUAL_OF_TYPE[question.type](choiceSliceCount(question.summary));
}

const COUNT_FORMAT = new Intl.NumberFormat("vi-VN");
const PERCENT_FORMAT = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });
const STAT_FORMAT = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

/** "1.234" (vi-VN grouping). */
export function formatCount(value: number): string {
  return COUNT_FORMAT.format(value);
}

/** "39,3%", "34%" — at most one decimal, no trailing ",0". */
export function formatPercent(value: number): string {
  return `${PERCENT_FORMAT.format(Math.round(value * 10) / 10)}%`;
}

/** Average / median: "4,1"; null → "—". */
export function formatStat(value: number | null): string {
  return value === null ? "—" : STAT_FORMAT.format(Math.round(value * 10) / 10);
}

/** "321 câu trả lời". */
export function responsesLabel(value: number): string {
  return `${formatCount(value)} câu trả lời`;
}

/**
 * Categorical slots, fixed order (validated: lightness band, chroma, CVD ΔE ≥ 10,
 * contrast ≥ 3:1 on white). Tokens `--color-chart-1..5` in `app/globals.css`.
 * Slot 1 is the brand primary. Color follows the option's position in the
 * form, never its rank, so it stays stable when counts change.
 */
export const CHART_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
] as const;

/** "Khác" (free answers) — always neutral. */
export const CHART_OTHER_COLOR = "var(--color-chart-other)";
/** Grid lines, axis ticks and bar tracks (`:root` in `app/globals.css`). */
export const CHART_GRID_COLOR = "var(--color-chart-grid)";
export const CHART_AXIS_COLOR = "var(--color-chart-axis)";
export const CHART_TRACK_COLOR = "var(--color-chart-track)";
/** Single-series bars (checkbox, scales, number bins). */
export const CHART_BAR_COLOR = CHART_COLORS[0];

/** Color of the option at `index` (form order). Donuts never exceed the slots (> 5 → bars). */
export function optionColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

/** One row of a distribution (legend/table/bar). */
export interface DistributionRow {
  key: string;
  label: string;
  count: number;
  percentage: number;
  color: string;
}

const normalizedLabel = (label: string) => label.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("vi");

/**
 * Name of the free-answer bucket: "Khác", or "Khác (tự nhập)" when the
 * question also has a real option labelled "Khác" (case/space-insensitive),
 * so the two never read the same.
 */
export function otherBucketLabel(summary: QuestionSummary): string {
  const clash = summary.kind === "choice" && summary.options.some((option) => normalizedLabel(option.label) === "khác");
  return clash ? "Khác (tự nhập)" : "Khác";
}

/** Rows of a choice / scale / number summary in display order; empty for text/file. */
export function distributionRows(question: Pick<QuestionAnalytics, "type" | "summary">): DistributionRow[] {
  const { summary } = question;
  switch (summary.kind) {
    case "choice": {
      const rows = summary.options.map((option, index) => ({
        key: `option:${option.value}`,
        label: option.label,
        count: option.count,
        percentage: option.percentage,
        color: visualOf(question) === "donut" ? optionColor(index) : CHART_BAR_COLOR,
      }));
      if (summary.other && summary.other.count > 0) {
        rows.push({
          key: "other",
          label: otherBucketLabel(summary),
          count: summary.other.count,
          percentage: summary.other.percentage,
          color: CHART_OTHER_COLOR,
        });
      }
      return rows;
    }
    case "scale":
      return summary.buckets.map((bucket) => ({
        key: `point:${bucket.value}`,
        label: question.type === "rating" ? `${bucket.value} ★` : String(bucket.value),
        count: bucket.count,
        percentage: bucket.percentage,
        color: CHART_BAR_COLOR,
      }));
    case "number":
      return summary.buckets.map((bucket, index) => ({
        key: `bin:${index}`,
        label: bucket.label,
        count: bucket.count,
        percentage: bucket.percentage,
        color: CHART_BAR_COLOR,
      }));
    default:
      return [];
  }
}

/** Multiple choice: shares are per respondent, so they may add up to more than 100%. */
export function sharesMayExceed100(question: Pick<QuestionAnalytics, "summary">): boolean {
  return question.summary.kind === "choice" && question.summary.multiple;
}

/** "Trắc nghiệm một lựa chọn", "Hộp kiểm"… — the card's type caption. */
export function questionTypeLabel(type: FormBlockType): string {
  switch (type) {
    case "single_choice":
      return "Một lựa chọn";
    case "multiple_choice":
      return "Nhiều lựa chọn";
    case "rating":
      return "Chấm sao";
    case "linear_scale":
      return "Thang đo";
    case "number":
      return "Số";
    case "text":
      return "Trả lời ngắn";
    case "textarea":
      return "Đoạn văn";
    case "date":
      return "Ngày";
    case "file_upload":
      return "Tải tệp lên";
  }
}

/** Header metrics; each is null when the data cannot back it (the tile is then hidden). */
export interface AnalyticsHeaderMetrics {
  totalResponses: number;
  /** 0–100, one decimal. */
  completionRate: number | null;
  averageDurationSeconds: number | null;
  lastResponseAt: string | null;
}

export function headerMetrics(analytics: FormAnalytics): AnalyticsHeaderMetrics {
  const { totalResponses, startedCount } = analytics;
  return {
    totalResponses,
    completionRate:
      startedCount && startedCount >= totalResponses && totalResponses > 0
        ? Math.round((totalResponses / startedCount) * 1000) / 10
        : null,
    averageDurationSeconds: totalResponses > 0 ? analytics.averageDurationSeconds : null,
    lastResponseAt: analytics.lastResponseAt,
  };
}

/** Questions tab: clamp `?question=` to an existing question (default: the first). */
export function resolveQuestionIndex(questions: readonly Pick<QuestionAnalytics, "questionId">[], id: string | null): number {
  if (!questions.length) return -1;
  const index = id ? questions.findIndex((question) => question.questionId === id) : -1;
  return index >= 0 ? index : 0;
}

/** A text-list answer as shown: a date answer "YYYY-MM-DD" reads "dd/mm/yyyy"; other types unchanged. */
export function formatAnswerSample(type: FormBlockType, value: string): string {
  return type === "date" ? formatDate(value) : value;
}

/** One figure of the card's stat row ("Trung bình" · "4,1 / 5"). */
export interface StatItem {
  label: string;
  value: string;
}

/** Scale: average (of max) · median · answer count; number: average · median · min · max; others: none. */
export function statItems(question: Pick<QuestionAnalytics, "summary" | "answeredCount">): StatItem[] {
  const { summary } = question;
  switch (summary.kind) {
    case "scale":
      return [
        {
          label: "Trung bình",
          value: summary.average === null ? "—" : `${formatStat(summary.average)} / ${formatCount(summary.max)}`,
        },
        { label: "Trung vị", value: formatStat(summary.median) },
        { label: "Tổng", value: formatCount(question.answeredCount) },
      ];
    case "number":
      return [
        { label: "Trung bình", value: formatStat(summary.average) },
        { label: "Trung vị", value: formatStat(summary.median) },
        { label: "Nhỏ nhất", value: formatStat(summary.min) },
        { label: "Lớn nhất", value: formatStat(summary.max) },
      ];
    default:
      return [];
  }
}
