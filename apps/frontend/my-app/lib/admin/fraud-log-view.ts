import { COMPLETION_CODE_POLICY } from "@rescom/schemas";
import type { FraudLogAccount, FraudLogEntry, FraudLogWindow } from "./fraud-log-service.ts";
import { shortCodeOf } from "./users-view.ts";

/** Pure presentation rules of Admin · FraudLog (Figma 11e) — unit-tested. */

/** Backend `details.action` of a wrong completion code (`prisma-participation.repository.ts`). */
export const WRONG_CODE_ACTION = "COMPLETION_CODE_VERIFICATION_FAILED";

/**
 * What the row shows as its code (Figma: "COMPLETION_CODE"). The backend files a
 * wrong completion code as `SECURITY_VIOLATION` with `details.action` above.
 */
export function fraudKindOf(entry: Pick<FraudLogEntry, "type" | "details">): string {
  if (entry.type === "SECURITY_VIOLATION" && entry.details?.action === WRONG_CODE_ACTION) return "COMPLETION_CODE";
  return entry.type;
}

export const FRAUD_TYPE_LABELS: Record<string, string> = {
  TIME_BARRIER: "Nộp quá nhanh",
  COMPLETION_CODE: "Sai mã hoàn thành",
  RATE_LIMIT: "Vượt giới hạn tần suất",
  COMPLAINT_UPHELD: "Khiếu nại được chấp nhận",
  DEMO_MISMATCH: "Hồ sơ không khớp",
  RECAPTCHA_FAIL: "Không qua reCAPTCHA",
  SECURITY_VIOLATION: "Vi phạm bảo mật",
};

export function fraudTypeLabel(type: string): string {
  return FRAUD_TYPE_LABELS[type] ?? type;
}

/** "Loại vi phạm" select. */
export const FRAUD_TYPE_OPTIONS = [
  { value: "", label: "Tất cả loại" },
  ...Object.entries(FRAUD_TYPE_LABELS).map(([value, label]) => ({ value, label })),
];

/** "Thời gian" select; the value is the `days` param ("" = all time). */
export const FRAUD_WINDOW_OPTIONS = [
  { value: "7", label: "7 ngày qua" },
  { value: "14", label: "14 ngày qua" },
  { value: "30", label: "30 ngày qua" },
  { value: "", label: "Toàn bộ" },
];

export function parseFraudWindow(value: string): FraudLogWindow {
  return value === "7" || value === "14" || value === "30" ? (Number(value) as 7 | 14 | 30) : null;
}

/** 48 → "48 giây", 150 → "2 phút 30 giây", 60 → "1 phút". */
export function formatSecondsVi(total: number): string {
  const seconds = Math.max(0, Math.round(total));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest} giây`;
  return rest === 0 ? `${minutes} phút` : `${minutes} phút ${rest} giây`;
}

const numberOf = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const textOf = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

/** "Chi tiết" column, from the entry's `details` (backend evidence keys). */
export function fraudDetailText(entry: Pick<FraudLogEntry, "type" | "details">): string {
  const details = entry.details ?? {};
  switch (fraudKindOf(entry)) {
    case "TIME_BARRIER": {
      const elapsed = numberOf(details.elapsedSeconds);
      const required = numberOf(details.requiredSeconds);
      if (elapsed === null) return "—";
      return required === null
        ? formatSecondsVi(elapsed)
        : `${formatSecondsVi(elapsed)} · tối thiểu ${formatSecondsVi(required)}`;
    }
    case "COMPLETION_CODE": {
      // Backend keys: failureCount (wrong codes on this attempt), isLocked.
      const failures = numberOf(details.failureCount);
      if (failures === null) return "—";
      const count = `Lần ${failures}/${COMPLETION_CODE_POLICY.maxFailuresPerAttempt}`;
      return details.isLocked === true ? `${count} · lượt làm bị khoá` : count;
    }
    case "COMPLAINT_UPHELD": {
      const points = numberOf(details.refundedPoints);
      const admin = textOf(details.adminName);
      const parts = [points === null ? null : `Trả ${points} điểm về ký quỹ`, admin];
      return parts.filter(Boolean).join(" · ") || "—";
    }
    default:
      return textOf(details.policyVersion) ?? "—";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Text shown in "Người dùng" when the page opens with `?userId=` (a UUID → its short code). */
export function initialUserText(param: string | null): string {
  const value = param?.trim() ?? "";
  return isUuid(value) ? shortCodeOf(value) : value;
}

/**
 * The "Người dùng" filter as request params: the exact `userId` while the field
 * still shows the code of the user the page was opened for, otherwise a search.
 */
export function resolveUserFilter(text: string, urlUserId: string | null): { userId?: string; search?: string } {
  const value = text.trim();
  if (!value) return {};
  if (isUuid(value)) return { userId: value };
  if (urlUserId && isUuid(urlUserId) && value.toUpperCase() === shortCodeOf(urlUserId)) return { userId: urlUserId };
  return { search: value };
}

/** Bottom banner of a repeat offender: bold lead + rest of the sentence. */
export function repeatBannerOf(account: FraudLogAccount, windowDays: number | null): { lead: string; rest: string } {
  const period = windowDays === null ? "" : ` trong ${windowDays} ngày`;
  const outcome =
    account.status === "LOCKED" ? "Tài khoản đã bị khoá." : "Hệ thống chỉ gắn cờ, không tự khoá.";
  return {
    lead: `${shortCodeOf(account.userId)} vi phạm lặp lại`,
    rest: ` · ${account.count} mục${period}. ${outcome}`,
  };
}
