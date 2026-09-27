/**
 * Date/time formatting in Vietnam time (Asia/Ho_Chi_Minh), whatever the
 * device's zone: server and client render the same text, and "today" follows
 * the Vietnamese calendar day. Pure module (no React).
 */

const TIME_ZONE = "Asia/Ho_Chi_Minh";

const PARTS_FORMAT = new Intl.DateTimeFormat("vi-VN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: TIME_ZONE,
});

export interface VietnamDateTimeParts {
  year: string;
  /** "09" */
  month: string;
  /** "26" */
  day: string;
  /** "14" (24h) */
  hour: string;
  minute: string;
}

/** Calendar parts of an ISO string / Date in Vietnam time; null when missing or invalid. */
export function vietnamDateTimeParts(value: string | Date | null | undefined): VietnamDateTimeParts | null {
  if (value === null || value === undefined) return null;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  const parts = PARTS_FORMAT.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  // Some engines print midnight as "24" with hour12: false.
  const hour = part("hour") === "24" ? "00" : part("hour");
  return { year: part("year"), month: part("month"), day: part("day"), hour, minute: part("minute") };
}

/** "26/09" */
export function formatDayMonth(value: string | Date | null | undefined): string {
  const parts = vietnamDateTimeParts(value);
  return parts ? `${parts.day}/${parts.month}` : "";
}

/** "14:32" */
export function formatTime(value: string | Date | null | undefined): string {
  const parts = vietnamDateTimeParts(value);
  return parts ? `${parts.hour}:${parts.minute}` : "";
}

/** "26/09 14:32" */
export function formatShortDateTime(value: string | Date | null | undefined): string {
  const parts = vietnamDateTimeParts(value);
  return parts ? `${parts.day}/${parts.month} ${parts.hour}:${parts.minute}` : "";
}

/** Vietnamese calendar day as `YYYY-MM-DD` (e.g. 26/09 18:00 UTC → "2026-09-27"). */
export function vietnamDateKey(value: string | Date): string {
  const parts = vietnamDateTimeParts(value);
  return parts ? `${parts.year}-${parts.month}-${parts.day}` : "";
}
