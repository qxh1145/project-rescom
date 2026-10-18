import { formatPoints } from "./top-up.ts";

/**
 * Extracts positive integer refundHoldPoints from error details (Story 13.11, Task 5, AC 10).
 * Returns 0 if absent, non-numeric, or <= 0.
 */
export function refundHoldPointsFrom(details: unknown): number {
  if (!details || typeof details !== "object") return 0;
  const raw = (details as Record<string, unknown>).refundHoldPoints;
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  return 0;
}

export function refundHoldSentence(n: number): string {
  return `${formatPoints(n)} Điểm đang giữ chờ hoàn tiền.`;
}
