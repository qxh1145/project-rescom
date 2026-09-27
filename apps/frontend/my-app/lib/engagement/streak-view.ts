import { vietnamDateKey } from "../format/date-time.ts";

/**
 * Pure presentation rules for Figma 16a "Chuỗi ngày" (63:4629) and the
 * "Chuỗi của bạn" card on 16b. Dates are `YYYY-MM-DD` strings, the same
 * format as `EngagementSummary.streak.week`.
 */

/** Monday → Sunday, as drawn in the "Tuần này" row. */
export const WEEKDAY_SHORT = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"] as const;
const WEEKDAY_LONG = ["Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy", "Chủ nhật"] as const;

/**
 * - done: at least one survey that day (flame on #F2B705)
 * - missed: a past day without a survey (#EEF1F6 disc)
 * - today: today, not counted yet (ASSUMED — not drawn)
 * - upcoming: later this week (dashed ring, Figma "CN")
 */
export type StreakDayState = "done" | "missed" | "today" | "upcoming";

export interface StreakDay {
  date: string;
  label: (typeof WEEKDAY_SHORT)[number];
  state: StreakDayState;
  isToday: boolean;
}

/**
 * "Today" of the streak as `YYYY-MM-DD` in Vietnam time (Asia/Ho_Chi_Minh),
 * whatever the device's zone — the same calendar the notification groups use.
 */
export function streakTodayKey(now: Date): string {
  return vietnamDateKey(now);
}

/** Monday-first weekday index (0 = Monday … 6 = Sunday) of a `YYYY-MM-DD` date. */
export function mondayIndex(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return (new Date(year, month - 1, day).getDay() + 6) % 7;
}

export function weekDays(week: readonly { date: string; done: boolean }[], today: string): StreakDay[] {
  return week.map((day, index) => {
    const isToday = day.date === today;
    let state: StreakDayState;
    if (day.done) state = "done";
    else if (isToday) state = "today";
    else if (day.date < today) state = "missed";
    else state = "upcoming";
    return { date: day.date, label: WEEKDAY_SHORT[index] ?? WEEKDAY_SHORT[0], state, isToday };
  });
}

export function formatDays(count: number): string {
  return `${count} ngày`;
}

/** Hero subtitle: "Hôm nay đã tính · kỷ lục của bạn: 1 ngày". */
export function streakStatusLine(streak: { longest: number; countedToday: boolean }): string {
  return `${streak.countedToday ? "Hôm nay đã tính" : "Hôm nay chưa tính"} · kỷ lục của bạn: ${formatDays(streak.longest)}`;
}

/**
 * Bottom CTA caption: Figma "Làm 1 khảo sát vào Chủ nhật để lên 2 ngày" when
 * today already counts; otherwise the survey has to happen today (ASSUMED copy).
 */
export function nextStreakHint(streak: { current: number; countedToday: boolean }, today: string): string {
  if (streak.countedToday) {
    const tomorrow = WEEKDAY_LONG[(mondayIndex(today) + 1) % 7];
    return `Làm 1 khảo sát vào ${tomorrow} để lên ${formatDays(streak.current + 1)}`;
  }
  if (streak.current === 0) return "Làm 1 khảo sát hôm nay để bắt đầu chuỗi";
  return `Làm 1 khảo sát hôm nay để lên ${formatDays(streak.current + 1)}`;
}
