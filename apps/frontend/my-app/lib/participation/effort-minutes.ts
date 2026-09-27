/**
 * The one estimated-duration formatter (Khám phá card, filter bounds, consent
 * card, survey headers): whole minutes rounded UP, at least 1 — a 4:10 survey
 * reads "5 phút", never less than it takes.
 */
export function effortMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(Math.max(0, seconds) / 60));
}

/** "5 phút". */
export function formatEffortMinutes(seconds: number): string {
  return `${effortMinutes(seconds)} phút`;
}

/** Longest duration still displayed as at most `minutes` (`effortMinutes(s) <= minutes`). */
export function maxSecondsShownAs(minutes: number): number {
  return minutes * 60;
}
