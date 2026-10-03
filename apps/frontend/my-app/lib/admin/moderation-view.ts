import {
  MODERATION_REJECTION_REASON_MAX_LENGTH,
  MODERATION_REJECTION_REASON_MIN_LENGTH,
  type FormTypeEnum,
  type Gender,
} from "@rescom/schemas";
import { formatShortDateTime, vietnamDateTimeParts } from "../format/date-time.ts";
import type { ModerationTargeting } from "./moderation-service.ts";

/**
 * Pure presentation rules of "Duyệt khảo sát" (Figma 11a 62:3406 / 11a'
 * 62:2868). No React, unit-tested in `tests/admin-moderation.test.mjs`.
 */

/** Figma tag "Google Forms" (blue) / "Trong Rescom" (green). */
export function surveySourceLabel(type: FormTypeEnum): string {
  return type === "EXTERNAL" ? "Google Forms" : "Trong Rescom";
}

/** Figma "Người đăng: Linh N." — name (ASSUMED field), else the email's local part. */
export function publisherLabel(survey: { publisherName?: string | null; publisherEmail: string | null }): string {
  const name = survey.publisherName?.trim();
  if (name) return name;
  const local = survey.publisherEmail?.split("@")[0];
  return local || "Người đăng";
}

/** Queue card line: "Linh N. · Google Forms · 26/09 19:30". */
export function queueCardMeta(survey: {
  publisherName?: string | null;
  publisherEmail: string | null;
  type: FormTypeEnum;
  submittedAt: string;
}): string {
  return [publisherLabel(survey), surveySourceLabel(survey.type), formatShortDateTime(survey.submittedAt)]
    .filter(Boolean)
    .join(" · ");
}

/** Figma "Thời gian khai 5–10 phút": the wizard's duration bands from the effort in seconds. */
export function effortBandLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 5) return "Dưới 5 phút";
  if (minutes <= 10) return "5–10 phút";
  if (minutes <= 15) return "10–15 phút";
  return "Trên 15 phút";
}

/** Figma "Hạn 10/10/2026"; "—" when the survey has no deadline. */
export function formatDeadline(iso: string | null | undefined): string {
  const parts = vietnamDateTimeParts(iso);
  return parts ? `${parts.day}/${parts.month}/${parts.year}` : "—";
}

const GENDER_LABELS: Record<Gender, string> = {
  MALE: "Nam",
  FEMALE: "Nữ",
  OTHER: "Khác",
  PREFER_NOT_TO_SAY: "Không muốn nêu",
};

/** "Trường Đại học FPT – Đà Nẵng" → "ĐH FPT Đà Nẵng" (Figma 11a). */
export function shortSchool(school: string): string {
  return school
    .replace(/^Trường\s+/, "")
    .replace(/^Đại học\s+/, "ĐH ")
    .replace(/\s+–\s+/g, " ")
    .trim();
}

/**
 * Figma 11a "Đối tượng": "Tất cả giới tính · 18–25 tuổi · Marketing & Truyền
 * thông, Kinh tế & QTKD · ĐH FPT Đà Nẵng · Đà Nẵng".
 */
export function targetingSummary(targeting: ModerationTargeting | null, invalid = false): string {
  if (invalid) return "Tiêu chí đối tượng lưu trữ không hợp lệ — không thể duyệt khảo sát này.";
  if (!targeting) return "Mọi người dùng (không giới hạn đối tượng)";
  const parts: string[] = [];
  parts.push(
    targeting.genders?.length ? targeting.genders.map((gender) => GENDER_LABELS[gender]).join(", ") : "Tất cả giới tính",
  );
  if (targeting.ageRange) {
    const { min, max } = targeting.ageRange;
    parts.push(min === max ? `${min} tuổi` : `${min}–${max} tuổi`);
  }
  if (targeting.fieldOfStudy?.length) parts.push(targeting.fieldOfStudy.join(", "));
  if (targeting.occupations?.length) parts.push(targeting.occupations.join(", "));
  if (targeting.schools?.length) parts.push(targeting.schools.map(shortSchool).join(", "));
  if (targeting.locations?.length) parts.push(targeting.locations.join(", "));
  return parts.join(" · ");
}

/**
 * Figma 11a "Kiểm tra trước khi duyệt". Client-side only (the API has no
 * checklist). ASSUMED: approval stays disabled until every item is ticked.
 */
export const REVIEW_CHECKLIST: readonly { id: string; label: string; types?: readonly FormTypeEnum[] }[] = [
  { id: "open-without-login", label: "Form mở được mà không cần đăng nhập", types: ["EXTERNAL"] },
  { id: "completion-code", label: "Trang cảm ơn có mã hoàn thành của Rescom", types: ["EXTERNAL"] },
  { id: "content", label: "Nội dung phù hợp, không hỏi thông tin nhạy cảm không cần thiết" },
  { id: "length", label: "Số câu hỏi khớp thời gian khai (tối đa 30 phút)" },
];

/** ASSUMED: the two Google Forms checks do not apply to an in-Rescom survey. */
export function checklistFor(type: FormTypeEnum) {
  return REVIEW_CHECKLIST.filter((item) => !item.types || item.types.includes(type));
}

/** Figma 11a' "Lý do chính" (the last one needs a note — ASSUMED (design)). */
export const REJECTION_REASONS: readonly { id: string; label: string; needsNote?: boolean }[] = [
  { id: "login-required", label: "Form yêu cầu đăng nhập, người ngoài không mở được" },
  { id: "missing-code", label: "Thiếu mã hoàn thành ở trang cảm ơn" },
  { id: "sensitive-data", label: "Hỏi thông tin cá nhân nhạy cảm" },
  { id: "duration-mismatch", label: "Thời gian khai không khớp độ dài form" },
  { id: "other", label: "Nội dung không phù hợp / lý do khác", needsNote: true },
];

const SEPARATOR = ". ";

/** Room left for the note once the preset label is in the 500-char `reason`. */
export function rejectionNoteMaxLength(reasonId: string | null): number {
  const preset = REJECTION_REASONS.find((reason) => reason.id === reasonId);
  return MODERATION_REJECTION_REASON_MAX_LENGTH - (preset ? preset.label.length + SEPARATOR.length : 0);
}

export type RejectionDraftError = "reasonRequired" | "noteRequired" | "noteTooShort" | "tooLong";

/**
 * Backend `reason` (one string, 5–500 chars) = "<preset>. <note>" — the
 * publisher reads both in the SURVEY_REJECTED notification.
 */
export function composeRejectionReason(
  reasonId: string | null,
  note: string,
): { ok: true; reason: string } | { ok: false; error: RejectionDraftError } {
  const preset = REJECTION_REASONS.find((reason) => reason.id === reasonId);
  if (!preset) return { ok: false, error: "reasonRequired" };
  const text = note.trim().replace(/\s+/g, " ");
  if (preset.needsNote && !text) return { ok: false, error: "noteRequired" };
  if (preset.needsNote && text.length < MODERATION_REJECTION_REASON_MIN_LENGTH) {
    return { ok: false, error: "noteTooShort" };
  }
  const reason = text ? `${preset.label}${SEPARATOR}${text}` : preset.label;
  if (reason.length > MODERATION_REJECTION_REASON_MAX_LENGTH) return { ok: false, error: "tooLong" };
  return { ok: true, reason };
}

/** Points the rejection returns: what the ledger holds, else the quote. */
export function refundPreview(survey: { escrowHeld: number | null; escrowAmount: number }): number {
  return survey.escrowHeld ?? survey.escrowAmount;
}

/** Why "Duyệt" is unavailable, or null when it can be clicked. */
export function approvalBlocker(
  survey: { status: string; targetingInvalid: boolean; fundingShortfall: number | null },
  checklistDone: boolean,
): "notQueued" | "targetingInvalid" | "notFunded" | "checklist" | null {
  if (survey.status !== "MODERATION_QUEUE") return "notQueued";
  if (survey.targetingInvalid) return "targetingInvalid";
  if ((survey.fundingShortfall ?? 0) > 0) return "notFunded";
  if (!checklistDone) return "checklist";
  return null;
}

/**
 * Next survey to show after a decision: the one after the decided id in the
 * old queue order, else the one before, else none.
 */
export function nextSelection(queueIds: readonly string[], decidedId: string): string | null {
  const index = queueIds.indexOf(decidedId);
  const remaining = queueIds.filter((id) => id !== decidedId);
  if (remaining.length === 0) return null;
  if (index < 0) return remaining[0];
  return remaining[Math.min(index, remaining.length - 1)];
}
