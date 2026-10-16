// Vietnam uses fixed UTC+7 with no Daylight Saving Time.
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Adds business days (Monday-Friday) to a given instant, evaluated in Vietnam time (UTC+7).
 * If the start falls on a Saturday or Sunday, it rolls forward to Monday 00:00:00 local time.
 * Then it steps forward by `days` business days, preserving the local time of day.
 * Returns the resulting instant in UTC.
 */
export function addBusinessDays(start: Date, days: number): Date {
  if (!Number.isInteger(days) || days < 0) {
    throw new Error('days must be a non-negative integer');
  }

  // Convert UTC instant to UTC+7 local wall time representation
  const localMs = start.getTime() + VN_OFFSET_MS;
  const localDate = new Date(localMs);

  let localYear = localDate.getUTCFullYear();
  let localMonth = localDate.getUTCMonth();
  let localDay = localDate.getUTCDate();
  const hours = localDate.getUTCHours();
  const minutes = localDate.getUTCMinutes();
  const seconds = localDate.getUTCSeconds();
  const ms = localDate.getUTCMilliseconds();

  // Day of week in UTC+7 (0 = Sunday, 6 = Saturday)
  const dayOfWeek = localDate.getUTCDay();

  let timeOfDayMs = (hours * 3600 + minutes * 60 + seconds) * 1000 + ms;

  if (dayOfWeek === 6) {
    // Saturday -> roll forward to Monday 00:00 local
    localDay += 2;
    timeOfDayMs = 0;
  } else if (dayOfWeek === 0) {
    // Sunday -> roll forward to Monday 00:00 local
    localDay += 1;
    timeOfDayMs = 0;
  }

  // Current calendar day anchor at 00:00 UTC (which maps to 00:00 local date)
  let currentMidnightUtc = Date.UTC(localYear, localMonth, localDay);

  let remainingDays = days;
  while (remainingDays > 0) {
    currentMidnightUtc += MS_PER_DAY;
    const currentDow = new Date(currentMidnightUtc).getUTCDay();
    if (currentDow !== 0 && currentDow !== 6) {
      remainingDays -= 1;
    }
  }

  const finalLocalMs = currentMidnightUtc + timeOfDayMs;
  return new Date(finalLocalMs - VN_OFFSET_MS);
}
