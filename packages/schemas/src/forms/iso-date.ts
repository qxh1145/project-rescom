const ISO_DATE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?([Zz]|[+-]\d{2}(?::?\d{2})?)?)?$/;

const DAY_MS = 24 * 60 * 60 * 1000;

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Strictly parses `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm[:ss[.fraction]][zone]`:
 * - the `T` separator and the `Z` zone may be lowercase;
 * - the fraction has 1 to 9 digits (read to the millisecond, truncated);
 * - the zone is `Z`, `±HH:mm`, `±HHmm` or `±HH`.
 * The whole value must match (anchored). Rejects impossible calendar values
 * (e.g. `2026-02-29`, `2026-99-99`) instead of letting `new Date()` roll them
 * over. A value without an offset is read as UTC so client and server agree
 * on the instant; a date-only value is the UTC day (a date-only bound spans
 * that UTC day, see `isoDateUpperBound`), not the reader's local day.
 *
 * Returns the UTC epoch milliseconds and whether the value was date-only, or
 * `null` when the value is not a real ISO date.
 */
export function parseStrictIsoDate(
  value: string,
): { time: number; dateOnly: boolean } | null {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const [, y, mo, d, h, mi, s, ms, zone] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = h === undefined ? 0 : Number(h);
  const minute = mi === undefined ? 0 : Number(mi);
  const second = s === undefined ? 0 : Number(s);
  // 1-9 fractional digits, truncated to whole milliseconds.
  const millis = ms === undefined ? 0 : Number(ms.padEnd(3, "0").slice(0, 3));

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  let offsetMinutes = 0;
  if (zone && zone !== "Z" && zone !== "z") {
    const digits = zone.slice(1).replace(":", "");
    const offsetHours = Number(digits.slice(0, 2));
    const offsetMins = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
    if (offsetHours > 23 || offsetMins > 59) return null;
    offsetMinutes = (zone[0] === "-" ? -1 : 1) * (offsetHours * 60 + offsetMins);
  }

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millis);
  const time = date.getTime() - offsetMinutes * 60 * 1000;
  if (Number.isNaN(time)) {
    return null;
  }
  return { time, dateOnly: h === undefined };
}

/**
 * Latest instant covered by a parsed bound: a date-only bound spans the whole
 * UTC day (inclusive through 23:59:59.999), a date-time bound is exact.
 */
export function isoDateUpperBound(parsed: {
  time: number;
  dateOnly: boolean;
}): number {
  return parsed.dateOnly ? parsed.time + DAY_MS - 1 : parsed.time;
}
