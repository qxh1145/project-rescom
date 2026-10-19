import {
  ADMIN_POINT_CREDIT_CONFIRM_THRESHOLD,
  ADMIN_POINT_CREDIT_MAX_AMOUNT,
  ADMIN_POINT_CREDIT_REASON_MIN,
  ADMIN_POINT_CREDIT_REASON_MAX,
  type UserRole,
} from "@rescom/schemas";
import type { AdminUserProfileSummary, AdminUserView } from "./users-service.ts";

/** Pure presentation rules of Admin · Người dùng (Figma 11d) — unit-tested. */

/** `#7F3A`: the short reference admins use in FraudLog and the overview (first 4 hex of the id). */
export function shortCodeOf(id: string): string {
  return `#${id.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

/** Figma shows the code before the name of accounts with FraudLog entries ("#7F3A · Đỗ Khang"). */
export function userTitleOf(user: Pick<AdminUserView, "id" | "email" | "name" | "fraudLog">): string {
  const name = user.name?.trim() || user.email;
  return user.fraudLog && user.fraudLog.count14d > 0 ? `${shortCodeOf(user.id)} · ${name}` : name;
}

export type PillTone = "teal" | "neutral" | "danger";

export interface StatusView {
  label: string;
  tone: PillTone;
}

export function userStatusView(user: Pick<AdminUserView, "status" | "activated">): StatusView {
  if (user.status === "LOCKED") return { label: "Đã khoá", tone: "danger" };
  if (user.activated === false) return { label: "Chưa kích hoạt", tone: "neutral" };
  return { label: "Hoạt động", tone: "teal" };
}

/**
 * "FraudLog 14 ngày" cell: a red "5 · lặp lại" pill only for a repeat offender
 * still waiting for an Admin decision (active account); otherwise the plain count.
 */
export function fraudCellOf(user: Pick<AdminUserView, "status" | "fraudLog">): { text: string; flagged: boolean } {
  if (!user.fraudLog) return { text: "Chưa có", flagged: false };
  const { count14d, repeated } = user.fraudLog;
  if (repeated && user.status === "ACTIVE") return { text: `${count14d} · lặp lại`, flagged: true };
  return { text: String(count14d), flagged: false };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `20/09` (local time). */
export function formatDayMonth(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Chưa có";
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

/** `26/09 15:31` (local time). */
export function formatDayMonthTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Chưa có";
  return `${formatDayMonth(iso)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const GENDER_LABELS: Record<string, string> = {
  MALE: "Nam",
  FEMALE: "Nữ",
  OTHER: "Khác",
  PREFER_NOT_TO_SAY: "Không chia sẻ giới tính",
};

/** "21 tuổi · Nam · Đà Nẵng · Sinh viên · Công nghệ thông tin"; null when nothing is known. */
export function profileLineOf(profile: AdminUserProfileSummary | null | undefined): string | null {
  if (!profile) return null;
  const parts = [
    profile.age !== null ? `${profile.age} tuổi` : null,
    profile.gender ? (GENDER_LABELS[profile.gender] ?? profile.gender) : null,
    profile.location,
    profile.occupation,
    profile.fieldOfStudy,
  ].filter((part): part is string => Boolean(part && part.trim()));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** "khang.do@gmail.com · đăng nhập Google". */
export function accountLineOf(user: Pick<AdminUserView, "email" | "signInMethod">): string {
  if (user.signInMethod === "GOOGLE") return `${user.email} · đăng nhập Google`;
  if (user.signInMethod === "PASSWORD") return `${user.email} · đăng nhập email`;
  return user.email;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  RESPONDENT: "Người trả lời",
  PUBLISHER: "Người đăng",
  ADMIN: "Admin",
};

/** Numbers of the detail cards; "—" when the ASSUMED field is missing. */
export function formatCount(value: number | undefined): string {
  return value === undefined ? "Chưa có" : value.toLocaleString("vi-VN");
}

export const LOCK_REASON_MIN = 10;
export const LOCK_REASON_MAX = 500;

export function reasonLengthError(
  reason: string,
  min: number,
  max: number,
  emptyMessage: string,
): string | null {
  const length = reason.trim().length;
  if (length === 0) return emptyMessage;
  if (length < min) return `Lý do cần ít nhất ${min} ký tự.`;
  if (length > max) return `Lý do tối đa ${max} ký tự.`;
  return null;
}

/**
 * Lock reason: required, 10–500 characters after trimming — mirrors `updateUserStatusSchema`
 * in `packages/schemas/src/users/admin-users.schema.ts`. The backend only records it in the
 * audit-log metadata (no e-mail is sent to the user).
 */
export function lockReasonError(reason: string): string | null {
  return reasonLengthError(
    reason,
    LOCK_REASON_MIN,
    LOCK_REASON_MAX,
    "Nhập lý do khoá: lý do được ghi vào nhật ký kiểm toán.",
  );
}

/**
 * Credit reason: required, 10–500 characters after trimming. Sent to respondent and recorded in audit log.
 */
export function creditReasonError(reason: string): string | null {
  return reasonLengthError(
    reason,
    ADMIN_POINT_CREDIT_REASON_MIN,
    ADMIN_POINT_CREDIT_REASON_MAX,
    "Nhập lý do: lý do được gửi cho người dùng và ghi nhật ký kiểm toán.",
  );
}

/**
 * Parse point credit amount input: integer 1..2,147,483,647.
 */
export function parseCreditAmount(raw: string): { amount: number } | { error: string } {
  const cleaned = raw.trim().replace(/[\s.,_]/g, "");
  if (!cleaned) return { error: "Nhập số Điểm cần cộng." };
  if (!/^\d+$/.test(cleaned)) return { error: "Nhập số nguyên dương." };
  const amount = Number(cleaned);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > ADMIN_POINT_CREDIT_MAX_AMOUNT) {
    return { error: `Số Điểm phải là số nguyên từ 1 đến ${ADMIN_POINT_CREDIT_MAX_AMOUNT.toLocaleString("vi-VN")}.` };
  }
  return { amount };
}

export function needsRetypeConfirm(amount: number): boolean {
  return amount > ADMIN_POINT_CREDIT_CONFIRM_THRESHOLD;
}

export function retypeMatches(raw: string, amount: number): boolean {
  const parsed = parseCreditAmount(raw);
  return "amount" in parsed && parsed.amount === amount;
}

/**
 * Why a lock / role change is refused up front (the backend refuses them too:
 * `CANNOT_LOCK_SELF`, `CANNOT_DEMOTE_SELF`). Null = allowed.
 */
export function selfActionBlock(userId: string, actorId: string | null | undefined, action: "lock" | "role"): string | null {
  if (!actorId || userId !== actorId) return null;
  return action === "lock"
    ? "Đây là tài khoản của bạn: Admin không thể tự khoá mình."
    : "Đây là tài khoản của bạn: Admin không thể tự đổi vai trò của mình.";
}
