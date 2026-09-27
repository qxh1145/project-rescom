import type { UserRole } from "@rescom/schemas";
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
  if (!user.fraudLog) return { text: "—", flagged: false };
  const { count14d, repeated } = user.fraudLog;
  if (repeated && user.status === "ACTIVE") return { text: `${count14d} · lặp lại`, flagged: true };
  return { text: String(count14d), flagged: false };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `20/09` (local time). */
export function formatDayMonth(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

/** `26/09 15:31` (local time). */
export function formatDayMonthTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
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
  return value === undefined ? "—" : value.toLocaleString("vi-VN");
}

export const LOCK_REASON_MIN = 10;
export const LOCK_REASON_MAX = 500;

/** Lock reason: required (it is logged and e-mailed), 10–500 characters. ASSUMED limits. */
export function lockReasonError(reason: string): string | null {
  const length = reason.trim().length;
  if (length === 0) return "Nhập lý do khoá — lý do được ghi vào nhật ký và gửi cho người dùng.";
  if (length < LOCK_REASON_MIN) return `Lý do cần ít nhất ${LOCK_REASON_MIN} ký tự.`;
  if (length > LOCK_REASON_MAX) return `Lý do tối đa ${LOCK_REASON_MAX} ký tự.`;
  return null;
}

/**
 * Why a lock / role change is refused up front (the backend refuses them too:
 * `CANNOT_LOCK_SELF`, `CANNOT_DEMOTE_SELF`). Null = allowed.
 */
export function selfActionBlock(userId: string, actorId: string | null | undefined, action: "lock" | "role"): string | null {
  if (!actorId || userId !== actorId) return null;
  return action === "lock"
    ? "Đây là tài khoản của bạn — Admin không thể tự khoá mình."
    : "Đây là tài khoản của bạn — Admin không thể tự đổi vai trò của mình.";
}
