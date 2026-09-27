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

export interface OpensSummary {
  /** "7 ngày qua". */
  window: string;
  total: number;
  /** Label of the busiest bucket, written out ("thứ Năm"); null when nothing was opened. */
  peak: string | null;
  /** Index of the busiest bucket (its value is printed above the bar). */
  peakIndex: number;
  max: number;
}

/** Figma 10a "7 ngày qua · 47 lượt mở · nhiều nhất thứ Năm". */
export function opensSummary(opens: {
  range: keyof typeof RANGE_WINDOWS;
  buckets: readonly { label: string; count: number }[];
}): OpensSummary {
  let peakIndex = -1;
  let max = 0;
  let total = 0;
  opens.buckets.forEach((bucket, index) => {
    total += bucket.count;
    if (bucket.count > max) {
      max = bucket.count;
      peakIndex = index;
    }
  });
  const peakLabel = peakIndex >= 0 ? opens.buckets[peakIndex].label : null;
  return {
    window: RANGE_WINDOWS[opens.range],
    total,
    peak: peakLabel === null ? null : (WEEKDAY_NAMES[peakLabel] ?? peakLabel),
    peakIndex,
    max,
  };
}
