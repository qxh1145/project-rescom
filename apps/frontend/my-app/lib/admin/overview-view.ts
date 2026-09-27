import { formatShortDateTime, vietnamDateTimeParts } from "../format/date-time.ts";
import { formatPoints, formatVnd } from "../wallet/top-up.ts";
import type { AdminOverview, AdminTodoItem, FlaggedAccount } from "./overview-service.ts";

/** Pure view rules of the admin "Tổng quan" (Figma 62:4070). */

const WEEKDAYS = ["Chủ Nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];
const WEEKDAY_INDEX = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "Asia/Ho_Chi_Minh" });
const WEEKDAY_KEYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Header meta: "Thứ Bảy, 26/09/2026" (Vietnam calendar day). */
export function formatAdminToday(now: Date): string {
  const parts = vietnamDateTimeParts(now);
  if (!parts) return "";
  const weekday = WEEKDAYS[WEEKDAY_KEYS.indexOf(WEEKDAY_INDEX.format(now))] ?? "";
  return `${weekday}, ${parts.day}/${parts.month}/${parts.year}`;
}

export interface StatCardView {
  label: string;
  value: string;
  /** Muted caption, or the green "Mở hàng chờ →" link text. */
  caption: string;
  captionTone: "muted" | "link";
  valueTone: "ink" | "danger" | "amber";
  href: string;
}

/** The four link cards (62:4126 → 62:4138). */
export function statCardsOf(overview: AdminOverview): StatCardView[] {
  const issues = overview.openIssues.disputes + overview.openIssues.missingCodeReports;
  return [
    {
      label: "Khảo sát chờ duyệt",
      value: String(overview.pendingSurveys.count),
      caption: "Mở hàng chờ →",
      captionTone: "link",
      valueTone: "ink",
      href: "/admin/surveys",
    },
    {
      label: "Yêu cầu nạp điểm chờ",
      value: String(overview.pendingTopUps.count),
      caption: `${formatPoints(overview.pendingTopUps.points)} điểm · ${formatVnd(overview.pendingTopUps.amountVnd)}`,
      captionTone: "muted",
      valueTone: "ink",
      href: "/admin/top-ups",
    },
    {
      label: "Khiếu nại & báo lỗi mở",
      value: String(issues),
      caption: `${overview.openIssues.disputes} khiếu nại · ${overview.openIssues.missingCodeReports} báo thiếu mã`,
      captionTone: "muted",
      // Figma draws the open-issue count in dark red; ASSUMED ink when nothing is open.
      valueTone: issues > 0 ? "danger" : "ink",
      href: "/admin/disputes",
    },
    {
      label: "Điểm đang ký quỹ",
      value: formatPoints(overview.escrow.points),
      caption: "Trên các khảo sát đang chạy",
      captionTone: "muted",
      valueTone: "amber",
      href: "/admin/transactions",
    },
  ];
}

export type TodoTone = "danger" | "neutral" | "amber" | "blue";

export interface TodoRowView {
  id: string;
  icon: "flag" | "file-text" | "wallet" | "alert-circle";
  tone: TodoTone;
  title: string;
  subtitle: string;
  /** Right-aligned note: "Ưu tiên" (danger) or "+2 khảo sát khác" (muted). */
  trailing: { text: string; tone: "danger" | "muted" } | null;
  href: string;
}

const HOUR_MS = 3_600_000;

/** "điểm còn chờ 31 giờ" — whole hours left before the disputed reward's 48h review ends. */
export function pendingWaitText(releasesAt: string | null, now: Date): string | null {
  if (!releasesAt) return null;
  const left = Math.ceil((Date.parse(releasesAt) - now.getTime()) / HOUR_MS);
  return left > 0 ? `điểm còn chờ ${left} giờ` : "đã hết 48 giờ chờ";
}

function moreText(item: AdminTodoItem): string | null {
  if (item.moreCount <= 0) return null;
  switch (item.kind) {
    case "SURVEY_REVIEW":
      return `+${item.moreCount} khảo sát khác`;
    case "TOP_UP":
      return `+${item.moreCount} yêu cầu`;
    case "DISPUTE":
      return `+${item.moreCount} khiếu nại`;
    case "MISSING_CODE":
      return `+${item.moreCount} báo lỗi`;
  }
}

/**
 * Where a to-do row leads. ASSUMED: each section reads `?id=` to open that
 * item (the section pages are built separately; adjust here if they use a
 * detail route instead).
 */
export function todoHref(item: AdminTodoItem): string {
  const id = encodeURIComponent(item.id);
  switch (item.kind) {
    case "DISPUTE":
    case "MISSING_CODE":
      return `/admin/disputes?id=${id}`;
    case "SURVEY_REVIEW":
      return `/admin/surveys?id=${id}`;
    case "TOP_UP":
      return `/admin/top-ups?id=${id}`;
  }
}

export function todoRowOf(item: AdminTodoItem, now: Date): TodoRowView {
  const more = moreText(item);
  const trailing = item.priority
    ? ({ text: "Ưu tiên", tone: "danger" } as const)
    : more
      ? ({ text: more, tone: "muted" } as const)
      : null;
  const base = { id: item.id, trailing, href: todoHref(item) };
  switch (item.kind) {
    case "DISPUTE":
      return {
        ...base,
        icon: "flag",
        tone: "danger",
        title: `Khiếu nại lượt làm #${item.attemptRef}`,
        subtitle: [item.respondentName, item.surveyTitle, pendingWaitText(item.pendingReleasesAt, now)]
          .filter(Boolean)
          .join(" · "),
      };
    case "SURVEY_REVIEW":
      return {
        ...base,
        icon: "file-text",
        tone: "neutral",
        title: `Duyệt: ${item.surveyTitle}`,
        subtitle: [
          item.publisherName,
          item.surveyType === "EXTERNAL" ? "Google Forms" : "Trong Rescom",
          `gửi ${formatShortDateTime(item.createdAt)}`,
        ].join(" · "),
      };
    case "TOP_UP":
      return {
        ...base,
        icon: "wallet",
        tone: "amber",
        title: `Nạp ${formatPoints(item.points)} điểm · ${item.requesterName}`,
        subtitle: `${formatVnd(item.amountVnd)} · nội dung CK ${item.transferReference}`,
      };
    case "MISSING_CODE":
      return {
        ...base,
        icon: "alert-circle",
        tone: "blue",
        title: "Báo thiếu mã hoàn thành",
        subtitle: `${item.reporterRole === "RESPONDENT" ? "Người trả lời báo" : "Người đăng báo"} · ${item.surveyTitle}`,
      };
  }
}

/** "Việc cần làm · cũ nhất trước": oldest first. */
export function todoRowsOf(items: readonly AdminTodoItem[], now: Date): TodoRowView[] {
  return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((item) => todoRowOf(item, now));
}

/** FraudLog types (backend `FraudLogType`; `COMPLETION_CODE` ASSUMED) → short Vietnamese reasons. */
const FRAUD_TYPE_LABELS: Record<string, string> = {
  TIME_BARRIER: "nộp quá nhanh",
  COMPLETION_CODE: "sai mã",
  RATE_LIMIT: "vượt giới hạn tần suất",
  DEMO_MISMATCH: "hồ sơ không khớp",
  RECAPTCHA_FAIL: "không qua kiểm tra chống bot",
  SECURITY_VIOLATION: "vi phạm bảo mật",
};

export function fraudTypeLabel(type: string): string {
  return FRAUD_TYPE_LABELS[type] ?? "hành vi bất thường";
}

export interface FlaggedAccountView {
  userId: string;
  title: string;
  subtitle: string;
  repeated: boolean;
  href: string;
}

export function flaggedAccountOf(account: FlaggedAccount): FlaggedAccountView {
  const reasons = [...new Set(account.types.map(fraudTypeLabel))].join(", ");
  return {
    userId: account.userId,
    title: `Người dùng #${account.reference}`,
    subtitle: [`${account.violationCount} lần trong ${account.windowDays} ngày`, reasons].filter(Boolean).join(" · "),
    repeated: account.repeated,
    href: `/admin/fraud-log?userId=${encodeURIComponent(account.userId)}`,
  };
}
