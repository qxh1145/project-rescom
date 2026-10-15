import { getVietnamCalendarDayRange } from './redemption-limits';

/**
 * Generates the next FS-{YYMMDD}-{A..Z} code for a given startsAt date.
 * Reuses getVietnamCalendarDayRange to determine the Vietnam calendar date.
 * Returns null if all 26 letter codes for that day are exhausted.
 */
export function nextFlashSaleCode(
  startsAt: Date,
  existingCodes: string[],
): string | null {
  const { start } = getVietnamCalendarDayRange(startsAt);
  const vnMidnight = new Date(start.getTime() + 7 * 3600 * 1000);
  const yy = String(vnMidnight.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(vnMidnight.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(vnMidnight.getUTCDate()).padStart(2, '0');
  const prefix = `FS-${yy}${mm}${dd}-`;

  const existingLetters = new Set(
    existingCodes
      .filter((c) => c.startsWith(prefix))
      .map((c) => c.slice(prefix.length).toUpperCase()),
  );

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let i = 0; i < alphabet.length; i++) {
    const letter = alphabet[i];
    if (!existingLetters.has(letter)) {
      return `${prefix}${letter}`;
    }
  }

  return null;
}
