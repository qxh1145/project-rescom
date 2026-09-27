import { boldRuns } from "./builder-ai.ts";

/**
 * "Hiện câu trả lời dần": `POST /forms/:id/ai/messages` (ASSUMED API CONTRACT)
 * answers in one piece, so a fresh answer is typed out on the client — text,
 * then bullets, then the follow-up — at a steady pace. Only the pacing is
 * client-side: every character shown is from the answer. When the backend
 * streams tokens, render them as they arrive instead.
 */

/** Typing speed of a fresh answer, in visible characters per second. */
export const REVEAL_CHARS_PER_SECOND = 140;
/** A long answer still finishes within this. */
export const REVEAL_MAX_MS = 3500;

/** How long revealing `total` characters takes. */
export function revealDurationMs(total: number): number {
  return Math.min(REVEAL_MAX_MS, (Math.max(0, total) / REVEAL_CHARS_PER_SECOND) * 1000);
}

/** Characters shown `elapsedMs` into revealing `total` characters. */
export function revealedAt(elapsedMs: number, total: number): number {
  const duration = revealDurationMs(total);
  if (duration <= 0 || elapsedMs >= duration) return total;
  return Math.max(0, Math.floor((elapsedMs / duration) * total));
}

/** Length of `text` as the reader sees it (without `**bold**` markers). */
export function visibleLength(text: string): number {
  return boldRuns(text).reduce((sum, run) => sum + run.text.length, 0);
}

/** The bold runs of `text`, cut to its first `limit` visible characters. */
export function cutRuns(text: string, limit: number): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  let left = Math.max(0, limit);
  for (const run of boldRuns(text)) {
    if (left <= 0) break;
    out.push(run.text.length <= left ? run : { text: run.text.slice(0, left), bold: run.bold });
    left -= run.text.length;
  }
  return out;
}

/** Splits `shown` characters over pieces of the given lengths, in order. */
export function revealSplit(lengths: readonly number[], shown: number): number[] {
  let left = Math.max(0, shown);
  return lengths.map((length) => {
    const take = Math.min(length, left);
    left -= take;
    return take;
  });
}
