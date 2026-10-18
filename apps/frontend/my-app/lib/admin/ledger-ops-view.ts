import { z } from "zod";
import { MATURED_PENDING_RELEASE_MAX_LIMIT, type LedgerAccountClass, type LedgerDriftedAccount } from "@rescom/schemas";
import { accountLabel } from "./admin-transactions.ts";
import { shortCodeOf } from "./users-view.ts";
import { formatPoints } from "../wallet/top-up.ts";

/** Pure rules of the Admin ledger operations panel (Story 14.4) — unit-tested. */

export type TransactionsTab = "ledger" | "ops";

/** Tabs of `/admin/transactions`; "Sổ giao dịch" is the default. */
export const TRANSACTIONS_TABS: ReadonlyArray<{ key: TransactionsTab; label: string }> = [
  { key: "ledger", label: "Sổ giao dịch" },
  { key: "ops", label: "Vận hành" },
];

export type RedriveTarget = "internal" | "external";

export const REDRIVE_TARGETS = [
  { value: "internal", label: "Bài trả lời (Internal)" },
  { value: "external", label: "Lượt làm (External)" },
] as const satisfies ReadonlyArray<{ value: RedriveTarget; label: string }>;

/** A mutating action waiting for the Admin's confirmation. */
export type LedgerOpAction =
  | { kind: "reconcile"; account: LedgerDriftedAccount }
  | { kind: "redrive"; target: RedriveTarget; id: string }
  | { kind: "release"; limit?: number; after?: string };

const uuidSchema = z.string().uuid();

/** The id typed for "Chạy lại trả thưởng": trimmed UUID, else an inline error (nothing is sent). */
export function parseRedriveId(raw: string): { id: string } | { error: string } {
  const value = raw.trim();
  if (!value) return { error: "Nhập mã bài trả lời hoặc lượt làm." };
  if (!uuidSchema.safeParse(value).success) return { error: "Mã không hợp lệ. Mã phải có dạng UUID." };
  return { id: value };
}

/** The optional release limit: empty = server default (`limit: undefined`), else an integer 1..max. */
export function parseReleaseLimit(raw: string): { limit: number | undefined } | { error: string } {
  const value = raw.trim();
  if (!value) return { limit: undefined };
  const limit = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MATURED_PENDING_RELEASE_MAX_LIMIT) {
    return { error: `Nhập số nguyên từ 1 đến ${MATURED_PENDING_RELEASE_MAX_LIMIT}, hoặc để trống.` };
  }
  return { limit };
}

const SETTLEMENT_STATUS_LABELS: Record<string, string> = {
  SETTLED: "Đã cộng vào Khả dụng",
  PENDING: "Đang chờ 48 giờ",
  HELD_IN_INTEGRITY: "Đang tạm giữ kiểm tra",
  SKIPPED_GUEST: "Bỏ qua — lượt làm của khách",
};

export function settlementStatusLabel(status: string): string {
  return SETTLEMENT_STATUS_LABELS[status] ?? status;
}

export function accountClassLabel(accountClass: LedgerAccountClass): string {
  return accountLabel(accountClass);
}

/** Owner of a drifted account: its short code, or "Hệ thống" for a system account. */
export function ownerLabel(userId: string | null): string {
  return userId ? shortCodeOf(userId) : "Hệ thống";
}

export interface ConfirmCopy {
  title: string;
  body: string;
  confirmLabel: string;
}

export const RELEASE_DEFAULT_LIMIT = 100;

export function confirmCopyOf(action: LedgerOpAction): ConfirmCopy {
  switch (action.kind) {
    case "reconcile":
      return {
        title: `Đối soát tài khoản ${ownerLabel(action.account.userId)} · ${accountClassLabel(action.account.accountClass)}?`,
        body: `Số dư hiển thị sẽ được tính lại bằng tổng các bút toán (hiện ${formatPoints(action.account.projectedBalance)} → ${formatPoints(action.account.calculatedBalance)} Điểm). Không tạo bút toán mới.`,
        confirmLabel: "Đối soát",
      };
    case "redrive":
      return {
        title: `Chạy lại trả thưởng cho ${action.target === "internal" ? "bài trả lời" : "lượt làm"} ${shortCodeOf(action.id)}?`,
        body: "Nếu chưa có khoản thưởng, hệ thống sẽ trả từ Ký quỹ của khảo sát; nếu đã có, chỉ trả về kết quả cũ. Không trả hai lần.",
        confirmLabel: "Chạy lại",
      };
    case "release":
      return {
        title: "Giải phóng Điểm chờ đã đủ 48 giờ?",
        body: `Tối đa ${action.limit ?? RELEASE_DEFAULT_LIMIT} khoản thưởng đang chờ quá 48 giờ sẽ được chuyển sang Khả dụng. Khoản đang bị khiếu nại được giữ lại.`,
        confirmLabel: "Giải phóng",
      };
  }
}
