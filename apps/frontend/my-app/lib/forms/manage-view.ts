import type { FormTypeEnum } from "@rescom/schemas";
import { formatDayMonth, formatShortDateTime, vietnamDateTimeParts } from "../format/date-time.ts";
import { sourceLabel, statusViewOf, type StatusFacts } from "./manage-status.ts";

/** Pure text helpers of the page 10 screens (list rows, survey header, tracking). */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Whole days left until `iso` (rounded up, never below 0); null without a date. */
export function daysUntil(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now) / DAY_MS));
}

/** Whole hours left until `iso` (rounded up, never below 0) — "còn 31 giờ". */
export function hoursUntil(iso: string, now: number): number {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 0;
  return Math.max(0, Math.ceil((at - now) / HOUR_MS));
}

/** "05/10/2026". */
export function formatFullDate(iso: string | null): string {
  const parts = vietnamDateTimeParts(iso);
  return parts ? `${parts.day}/${parts.month}/${parts.year}` : "";
}

/** "7 phút 40 giây", "45 giây", "8 phút". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes === 0) return `${rest} giây`;
  return rest === 0 ? `${minutes} phút` : `${minutes} phút ${rest} giây`;
}

/** Rounded share in percent; 0 when there is no base. */
export function percentOf(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

interface ListRowFacts extends StatusFacts {
  type: FormTypeEnum;
  submittedAt: string | null;
  createdAt: string;
  deadlineAt: string | null;
  closedAt: string | null;
  hiddenFromMarketplace: boolean;
}

/**
 * Desktop row subtitle (Figma 63:177, 63:188, 63:202):
 * "Google Forms · gửi 26/09 19:30", "Google Forms · hạn 05/10 · còn 9 ngày",
 * "Form Builder · kết thúc 22/09 · đã ẩn khỏi Khám phá".
 */
export function listRowMeta(form: ListRowFacts, now: number): string {
  const source = sourceLabel(form.type);
  switch (statusViewOf(form)) {
    case "PENDING_REVIEW":
      return `${source} · gửi ${formatShortDateTime(form.submittedAt ?? form.createdAt)}`;
    case "RUNNING":
    case "PAUSED": {
      const days = daysUntil(form.deadlineAt, now);
      return days === null
        ? `${source} · không giới hạn thời gian`
        : `${source} · hạn ${formatDayMonth(form.deadlineAt)} · còn ${days} ngày`;
    }
    case "FULL":
    case "ENDED": {
      const ended = form.closedAt ? ` · kết thúc ${formatDayMonth(form.closedAt)}` : "";
      return `${source}${ended}${form.hiddenFromMarketplace ? " · đã ẩn khỏi Khám phá" : ""}`;
    }
    case "DRAFT":
    case "REJECTED":
      return `${source} · tạo ${formatDayMonth(form.createdAt)}`;
  }
}

interface HeaderFacts extends StatusFacts {
  type: FormTypeEnum;
  rewardPerResponse: number;
  estimatedDurationMinutes?: number | null;
  questionCount: number | null;
  audienceLabel: string | null;
  closedAt: string | null;
  currentVersion: { schemaJson?: { blocks?: unknown[] } | null };
}

/** Question count: the ASSUMED `questionCount`, else the current version's blocks. */
export function questionCountOf(form: Pick<HeaderFacts, "questionCount" | "currentVersion">): number | null {
  if (form.questionCount !== null) return form.questionCount;
  const blocks = form.currentVersion.schemaJson?.blocks;
  return blocks && blocks.length > 0 ? blocks.length : null;
}

/**
 * Survey header meta line. Desktop (Figma 10a / 17):
 * "Google Forms · 8 phút · 10 điểm/lượt · Marketing, QTKD · 18–25 tuổi",
 * "Form Builder · 8 câu hỏi · 6 phút · 12 điểm/lượt · kết thúc 22/09/2026".
 * `short` = mobile subtitle "Google Forms · 8 phút · 10 điểm/lượt".
 */
export function headerMeta(form: HeaderFacts, short = false): string {
  const parts: string[] = [sourceLabel(form.type)];
  const questions = form.type === "INTERNAL" ? questionCountOf(form) : null;
  if (questions !== null && !short) parts.push(`${questions} câu hỏi`);
  if (form.estimatedDurationMinutes) parts.push(`${form.estimatedDurationMinutes} phút`);
  parts.push(`${form.rewardPerResponse} điểm/lượt`);
  if (!short) {
    if (form.audienceLabel) parts.push(form.audienceLabel);
    const view = statusViewOf(form);
    if ((view === "FULL" || view === "ENDED") && form.closedAt) parts.push(`kết thúc ${formatFullDate(form.closedAt)}`);
  }
  return parts.join(" · ");
}

const WEEKDAY_NAMES: Record<string, string> = {
  T2: "thứ Hai",
  T3: "thứ Ba",
  T4: "thứ Tư",
  T5: "thứ Năm",
  T6: "thứ Sáu",
  T7: "thứ Bảy",
  CN: "Chủ nhật",
};

const RANGE_WINDOWS = { hour: "24 giờ qua", day: "7 ngày qua", week: "4 tuần qua", month: "6 tháng qua" } as const;

const VN_OFFSET_MS = 7 * HOUR_MS;
const WEEKDAY_LABELS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/**
 * Client label of a `completionsSeries` bucket, from its UTC `startsAt` in
 * Vietnam time: `hour` → "0h".."21h"; `day` → "T2".."CN"; `week` → "dd/MM"
 * of the Monday; `month` → "T1".."T12".
 */
export function seriesBucketLabel(range: keyof typeof RANGE_WINDOWS, startsAt: string): string {
  const at = Date.parse(startsAt);
  if (Number.isNaN(at)) return "";
  const local = new Date(at + VN_OFFSET_MS);
  switch (range) {
    case "hour":
      return `${local.getUTCHours()}h`;
    case "day":
      return WEEKDAY_LABELS[local.getUTCDay()];
    case "week":
      return formatDayMonth(startsAt);
    case "month":
      return `T${local.getUTCMonth() + 1}`;
  }
}

export interface SeriesBucket {
  label: string;
  count: number;
}

/** The labelled bars of a series. */
export function seriesBuckets(series: {
  range: keyof typeof RANGE_WINDOWS;
  buckets: readonly { startsAt: string; count: number }[];
}): SeriesBucket[] {
  return series.buckets.map((bucket) => ({ label: seriesBucketLabel(series.range, bucket.startsAt), count: bucket.count }));
}

export interface SeriesSummary {
  /** "7 ngày qua". */
  window: string;
  total: number;
  /** Label of the busiest bucket, written out ("thứ Năm"); null when nothing completed. */
  peak: string | null;
  /** Index of the busiest bucket (its value is printed above the bar). */
  peakIndex: number;
  max: number;
}

/** "thứ Năm" for a day bucket, "tháng 2" for a month bucket ("T2" both ways). */
function peakName(range: keyof typeof RANGE_WINDOWS, label: string): string {
  if (range === "day") return WEEKDAY_NAMES[label] ?? label;
  if (range === "month") return `tháng ${label.slice(1)}`;
  return label;
}

/** Figma 10a "7 ngày qua · 5 lượt hoàn thành · nhiều nhất thứ Năm". */
export function seriesSummary(series: {
  range: keyof typeof RANGE_WINDOWS;
  buckets: readonly { startsAt: string; count: number }[];
}): SeriesSummary {
  const labelled = seriesBuckets(series);
  let peakIndex = -1;
  let max = 0;
  let total = 0;
  labelled.forEach((bucket, index) => {
    total += bucket.count;
    if (bucket.count > max) {
      max = bucket.count;
      peakIndex = index;
    }
  });
  const peakLabel = peakIndex >= 0 ? labelled[peakIndex].label : null;
  return {
    window: RANGE_WINDOWS[series.range],
    total,
    peak: peakLabel === null ? null : peakName(series.range, peakLabel),
    peakIndex,
    max,
  };
}
