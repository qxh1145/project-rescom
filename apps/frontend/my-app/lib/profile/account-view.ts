import { displaySchoolName, GENDER_OPTIONS } from "../demographic-options.ts";
import type { EngagementSummary } from "../engagement/engagement-service.ts";
import { nextTierProgress, tierOf } from "../engagement/tiers.ts";
import {
  checkBirthYear,
  GOAL_LABELS,
  profileSummary,
  type OnboardingAnswers,
} from "../onboarding/onboarding-answers.ts";
import { isStudentOccupation, type QuestionStep } from "../onboarding/onboarding-steps.ts";
import type { IntegrityConsent } from "../participation/consent-service.ts";
import type { ReliabilitySummary } from "../participation/trust-service.ts";

/**
 * View rules of Figma 15g "Tài khoản" (63:483 / 63:1426) and 15h "Hồ sơ"
 * (63:2469). Pure module: dates and the current year are passed in.
 */

/** Value shown for an unanswered profile field. ASSUMED (not drawn). */
export const EMPTY_FIELD_VALUE = "Chưa có";

export interface ProfileField {
  label: string;
  value: string;
  /** The onboarding question that edits it ("Sửa"). */
  step: QuestionStep;
}

export interface ProfileFieldGroup {
  /** Anchor id (`/account/profile#hoc-tap`). */
  id: "ve-ban" | "hoc-tap" | "so-thich";
  title: string;
  fields: ProfileField[];
}

const or = (value: string | null | undefined) => (value && value.trim() ? value : EMPTY_FIELD_VALUE);

/** "2005 · 21 tuổi". */
export function birthYearLabel(answers: OnboardingAnswers, currentYear: number): string {
  const check = checkBirthYear(answers.birthYear, currentYear);
  return check.ok ? `${check.year} · ${check.age} tuổi` : EMPTY_FIELD_VALUE;
}

/** 15h field list; "Trường" / "Năm học" only for students (same rule as onboarding 12.6/12.7). */
export function profileFieldGroups(answers: OnboardingAnswers, currentYear: number): ProfileFieldGroup[] {
  const gender = GENDER_OPTIONS.find((option) => option.value === answers.gender)?.label;
  const student = isStudentOccupation(answers.occupation);
  const study: ProfileField[] = [{ label: "Nghề nghiệp", value: or(answers.occupation), step: "occupation" }];
  if (student) {
    study.push(
      { label: "Trường", value: answers.school ? displaySchoolName(answers.school) : EMPTY_FIELD_VALUE, step: "school" },
      { label: "Năm học", value: or(answers.schoolYear), step: "school-year" },
    );
  }
  study.push(
    { label: "Ngành", value: or(answers.fieldOfStudy), step: "field" },
    { label: "Thu nhập hộ gia đình", value: or(answers.householdIncome), step: "income" },
  );
  return [
    {
      id: "ve-ban",
      title: "Về bạn",
      fields: [
        { label: "Tên hiển thị", value: or(answers.displayName), step: "name" },
        { label: "Năm sinh", value: birthYearLabel(answers, currentYear), step: "birth-year" },
        { label: "Giới tính", value: or(gender), step: "gender" },
        { label: "Tỉnh/thành", value: or(answers.location), step: "location" },
      ],
    },
    { id: "hoc-tap", title: "Học tập & công việc", fields: study },
    {
      id: "so-thich",
      title: "Sở thích & mục tiêu",
      fields: [
        {
          label: "Sở thích",
          value: answers.interests.length > 0 ? `${answers.interests.length} chủ đề` : EMPTY_FIELD_VALUE,
          step: "interests",
        },
        { label: "Mục tiêu", value: answers.goal ? GOAL_LABELS[answers.goal] : EMPTY_FIELD_VALUE, step: "goal" },
      ],
    },
  ];
}

/**
 * "Sửa": ASSUMED — no per-field editor is drawn, so it reopens that onboarding
 * question (prefilled from the server) and comes back here after "Hoàn tất".
 * `edit=1` lets a finished respondent past the `/onboarding` entry guard.
 */
export function profileEditHref(step: QuestionStep): string {
  const params = new URLSearchParams({ step, edit: "1", returnTo: "/account/profile" });
  return `/onboarding?${params.toString()}`;
}

/** Row "Thông tin cá nhân": "21 tuổi · Nữ · Đà Nẵng". */
export function personalSummary(answers: OnboardingAnswers, currentYear: number): string {
  const text = profileSummary(answers, currentYear)
    .filter((item) => item.field === "age" || item.field === "gender" || item.field === "location")
    .map((item) => item.text)
    .join(" · ");
  return text || EMPTY_FIELD_VALUE;
}

/** Row "Học tập & sở thích": "Marketing · 4 chủ đề". */
export function studySummary(answers: OnboardingAnswers, currentYear: number): string {
  const text = profileSummary(answers, currentYear)
    .filter((item) => item.field === "fieldOfStudy" || item.field === "interests")
    .map((item) => item.text)
    .join(" · ");
  return text || EMPTY_FIELD_VALUE;
}

/** "Đã đồng ý v1 · 26/09" (Vietnam time) or "Chưa đồng ý" (ASSUMED (design) copy). */
export function consentLabel(consent: IntegrityConsent): string {
  if (consent.acceptedVersion === null) return "Chưa đồng ý";
  if (!consent.acceptedAt) return `Đã đồng ý v${consent.acceptedVersion}`;
  const parts = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
  }).formatToParts(new Date(consent.acceptedAt));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `Đã đồng ý v${consent.acceptedVersion} · ${part("day")}/${part("month")}`;
}

/** Same wording as the 17d pill (`TrustScreen`). */
export const RELIABILITY_LEVEL_LABEL: Record<ReliabilitySummary["level"], string> = {
  FORMING: "Đang hình thành",
  GOOD: "Tốt",
  REVIEW: "Cần chú ý",
};

/** Row "Bảng xếp hạng": "Tuần này #41"; unranked ASSUMED "Chưa có hạng tuần này". */
export function weeklyRankLabel(rank: number | null): string {
  return rank === null ? "Chưa có hạng tuần này" : `Tuần này #${rank}`;
}

/** Row "Thông báo": "3 chưa đọc" / "Đã đọc hết" (ASSUMED). */
export function unreadLabel(count: number): string {
  return count > 0 ? `${count} chưa đọc` : "Đã đọc hết";
}

export interface TierCardView {
  tierName: string;
  streakDays: number;
  completed: number;
  published: number;
  /** Null at the top tier. */
  next: { name: string; current: number; target: number; hint: string } | null;
}

/**
 * "Làm thêm 18 khảo sát để được ưu tiên hiển thị trên Khám phá." With enough
 * surveys but no promotion yet: at level 1 only the profile gate of level 2 is
 * left (ASSUMED (design) copy); from level 2 the tier is simply not recomputed yet —
 * the same wording as 16 "Hạng thành viên" (`TierScreen`).
 */
export function nextTierHint(level: number, remaining: number, unlockPhrase: string): string {
  if (remaining > 0) return `Làm thêm ${remaining} khảo sát để ${unlockPhrase}.`;
  if (level === 1) return `Hoàn tất hồ sơ để ${unlockPhrase}.`;
  return "Đã đủ khảo sát, hạng sẽ được cập nhật sớm.";
}

/** Profile card: tier pill, 3 stats and "Cấp tiếp theo" (Figma 63:1433). */
export function tierCardView(summary: EngagementSummary): TierCardView {
  const progress = nextTierProgress(summary.tier.level, summary.stats.completedSurveys);
  return {
    tierName: tierOf(summary.tier.level).name,
    streakDays: summary.streak.current,
    completed: summary.stats.completedSurveys,
    published: summary.stats.publishedSurveys,
    next: progress
      ? {
          name: progress.next.name,
          current: progress.current,
          target: progress.target,
          hint: nextTierHint(summary.tier.level, progress.remaining, progress.next.unlockPhrase),
        }
      : null,
  };
}
