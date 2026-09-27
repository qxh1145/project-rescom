import {
  TOP_UP_REFERENCE_PREFIX,
  TOP_UP_REJECTION_REASON_MAX_LENGTH,
  TOP_UP_REJECTION_REASON_MIN_LENGTH,
  type TopUpStatus,
} from "@rescom/schemas";
import { formatVnd } from "../wallet/top-up.ts";

/** Pure rules of the admin top-up queue (Figma 11b, 63:369). */

export { TOP_UP_REJECTION_REASON_MAX_LENGTH, TOP_UP_REJECTION_REASON_MIN_LENGTH };

/** "Lọc yêu cầu" segments; the pending one carries the queue size ("Chờ duyệt · 2"). */
export function topUpStatusTabs(pendingCount: number | undefined): Array<{ value: TopUpStatus; label: string }> {
  return [
    { value: "PENDING", label: pendingCount === undefined ? "Chờ duyệt" : `Chờ duyệt · ${pendingCount}` },
    { value: "APPROVED", label: "Đã duyệt" },
    { value: "REJECTED", label: "Đã từ chối" },
  ];
}

/**
 * "RESCOMMT4492QA" → "RESCOM MT4492QA" (Figma shows the prefix apart). The
 * user still transfers the reference without the space; display only.
 */
export function formatTransferReference(reference: string): string {
  return reference.startsWith(TOP_UP_REFERENCE_PREFIX) && reference.length > TOP_UP_REFERENCE_PREFIX.length
    ? `${TOP_UP_REFERENCE_PREFIX} ${reference.slice(TOP_UP_REFERENCE_PREFIX.length)}`
    : reference;
}

/** Requester label: ASSUMED `userName`, else the email's local part. */
export function requesterName(item: { userName?: string | null; userEmail: string | null }): string {
  if (item.userName) return item.userName;
  if (item.userEmail) return item.userEmail.split("@")[0];
  return "Người dùng";
}

/**
 * "Đã đối chiếu sao kê" checklist. ASSUMED: the admin ticks all three before
 * "Duyệt" is enabled (Figma draws two ticked, one not); the backend has no
 * such field — it is a UI guard for an irreversible credit.
 */
export function reviewChecks(item: { amountVnd: number; transferReference: string }): string[] {
  return [
    `Đúng số tiền ${formatVnd(item.amountVnd)}`,
    `Đúng nội dung ${formatTransferReference(item.transferReference)}`,
    "Giao dịch chưa được dùng cho yêu cầu khác",
  ];
}

/** Reject dialog validation, same bounds as `rejectTopUpRequestSchema` (trimmed). */
export function rejectReasonError(reason: string): string | null {
  const length = reason.trim().length;
  if (length === 0) return "Nhập lý do từ chối để người dùng biết cần làm gì.";
  if (length < TOP_UP_REJECTION_REASON_MIN_LENGTH) {
    return `Lý do cần ít nhất ${TOP_UP_REJECTION_REASON_MIN_LENGTH} ký tự.`;
  }
  if (length > TOP_UP_REJECTION_REASON_MAX_LENGTH) {
    return `Lý do tối đa ${TOP_UP_REJECTION_REASON_MAX_LENGTH} ký tự.`;
  }
  return null;
}

/**
 * Row to show after the list changed: keep the current one if still listed,
 * otherwise the row that took its place (next in the queue), else the first.
 */
export function nextSelectedId(
  items: ReadonlyArray<{ id: string }>,
  currentId: string | null,
  previousIds: readonly string[] = [],
): string | null {
  if (items.length === 0) return null;
  if (currentId && items.some((item) => item.id === currentId)) return currentId;
  const index = currentId ? previousIds.indexOf(currentId) : -1;
  if (index >= 0) {
    const after = previousIds.slice(index + 1).find((id) => items.some((item) => item.id === id));
    if (after) return after;
  }
  return items[0].id;
}
