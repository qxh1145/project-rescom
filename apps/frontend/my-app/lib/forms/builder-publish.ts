import {
  calculateEscrowCost,
  getRewardPricingRange,
  MAX_PUBLISHABLE_DURATION_MINUTES,
  resolveEffectiveDurationMinutes,
  resolveRewardBandDurationOptions,
  surveyTargetingSchema,
  type Gender,
  type RewardBandDefinitionLike,
  type SurveyTargetingCriteria,
} from "@rescom/schemas";
import { z } from "zod";
import { validateForPublish, type BuilderDoc } from "./builder-blocks.ts";

/**
 * Publish settings (builder steps 2 "Đối tượng" and 3 "Số mẫu & điểm") and
 * the FR-14 price hint (Figma 13a), decision C2 (a): "Giá gợi ý" is the
 * reward band the respondent receives — the band the backend checks
 * (`checkPublishRewardBand` on the effective duration) — and a second figure
 * is what the publisher pays per response at the 20 % Internal-form discount
 * (`calculateEscrowCost`).
 */

export const INTERNAL_DISCOUNT = 0.8;

export interface InternalPriceHint {
  /** Reward band (what the respondent receives; the reward field is checked against it). */
  min: number;
  max: number;
  label: string;
  /** Per-response cost to the publisher after the Internal discount. */
  paidMin: number;
  paidMax: number;
  paidLabel: string;
}

function internalCostPerResponse(reward: number): number {
  return calculateEscrowCost({ type: "INTERNAL", expectedCompletions: 1, rewardPerResponse: reward }).effectiveRewardPerResponse;
}

/**
 * `definition` (the stored or draft Form Definition) makes the band follow
 * the backend's effective duration: the longest of `minutes`, the declared
 * effort and the required minimum completion time.
 */
export function internalPriceHint(minutes: number, definition?: RewardBandDefinitionLike | null): InternalPriceHint {
  const estimate = Math.max(1, minutes);
  const duration =
    resolveEffectiveDurationMinutes({
      estimatedDurationMinutes: estimate,
      ...(definition ? resolveRewardBandDurationOptions("INTERNAL", definition) : {}),
    }) ?? estimate;
  const band = getRewardPricingRange(duration);
  const paidMin = internalCostPerResponse(band.min);
  const paidMax = internalCostPerResponse(band.max);
  return {
    min: band.min,
    max: band.max,
    label: `${band.min}–${band.max} điểm/lượt`,
    paidMin,
    paidMax,
    paidLabel: `bạn trả ${paidMin}–${paidMax} điểm/lượt`,
  };
}

export const publishSettingsSchema = z.object({
  expectedCompletions: z.coerce
    .number({ invalid_type_error: "Nhập số mẫu cần thu." })
    .int("Số mẫu phải là số nguyên.")
    .min(1, "Cần ít nhất 1 mẫu.")
    .max(100_000, "Tối đa 100.000 mẫu."),
  rewardPerResponse: z.coerce
    .number({ invalid_type_error: "Nhập số điểm mỗi lượt." })
    .int("Điểm phải là số nguyên.")
    .min(0, "Điểm không được âm.")
    .max(10_000, "Tối đa 10.000 điểm mỗi lượt."),
  estimatedDurationMinutes: z.coerce
    .number({ invalid_type_error: "Nhập thời lượng." })
    .int("Thời lượng tính bằng phút.")
    .min(1, "Ít nhất 1 phút.")
    .max(
      MAX_PUBLISHABLE_DURATION_MINUTES,
      `Tối đa ${MAX_PUBLISHABLE_DURATION_MINUTES} phút: mỗi lượt làm bài chỉ được giữ chỗ ${MAX_PUBLISHABLE_DURATION_MINUTES} phút.`,
    ),
});
export type PublishSettings = z.infer<typeof publishSettingsSchema>;

export type PublishSettingsErrors = Partial<Record<keyof PublishSettings, string>>;

/**
 * Whether a raw "Thời lượng dự kiến" input parses to a duration inside the
 * publishable range (same bounds as `publishSettingsSchema`). The FR-14
 * price hint (`internalPriceHint`) uses this to decide whether to recompute
 * from the typed value or keep the last valid one — so a stray keystroke
 * ("0", "99999", "abc") never flashes a price band for a duration that could
 * never actually publish.
 */
export function isValidDurationInput(raw: string): boolean {
  const trimmed = raw.trim();
  if (trimmed === "") return false;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_PUBLISHABLE_DURATION_MINUTES;
}

export function validatePublishSettings(input: Record<keyof PublishSettings, string>):
  | { ok: true; value: PublishSettings }
  | { ok: false; errors: PublishSettingsErrors } {
  const parsed = publishSettingsSchema.safeParse({
    expectedCompletions: input.expectedCompletions.trim() === "" ? undefined : input.expectedCompletions,
    rewardPerResponse: input.rewardPerResponse.trim() === "" ? undefined : input.rewardPerResponse,
    estimatedDurationMinutes: input.estimatedDurationMinutes.trim() === "" ? undefined : input.estimatedDurationMinutes,
  });
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: PublishSettingsErrors = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof PublishSettings;
    errors[key] ??= input[key].trim() === "" ? "Trường này là bắt buộc." : issue.message;
  }
  return { ok: false, errors };
}

/** What the escrow reservation would cost (`calculateEscrowCost`, Internal −20 %). */
export function estimateEscrow(settings: Pick<PublishSettings, "expectedCompletions" | "rewardPerResponse">): number {
  return settings.expectedCompletions * Math.round(settings.rewardPerResponse * INTERNAL_DISCOUNT);
}

/** A survey that already had a published version keeps its reward (backend 409 `FORM_PUBLISHED_FIELDS_IMMUTABLE`). */
export const FROZEN_REWARD_HINT = "Giữ nguyên điểm thưởng của phiên bản đã đăng";

export type PublishReadiness = "ready" | "unsaved" | "invalid";

/**
 * C4: the publish step only opens on a saved, publishable draft — unsaved
 * edits on this device (`loadLocalDraft(...).dirty`) or a definition that
 * fails `validateForPublish` send the publisher back to the builder, whose
 * "Tiếp tục" flow validates and saves first. The estimated duration is set on
 * the publish step itself, so it is checked there (settings schema).
 */
export function publishReadiness(input: { doc: BuilderDoc; localDirty: boolean }): PublishReadiness {
  if (input.localDirty) return "unsaved";
  const issues = validateForPublish(input.doc);
  return issues.form.length > 0 || Object.keys(issues.blocks).length > 0 ? "invalid" : "ready";
}

export const PUBLISH_READINESS_NOTICE: Record<Exclude<PublishReadiness, "ready">, string> = {
  unsaved: "Form còn thay đổi chưa lưu trên máy này. Quay lại Form Builder để lưu và kiểm tra trước khi gửi duyệt.",
  invalid: "Form chưa đủ điều kiện gửi duyệt. Quay lại Form Builder để sửa các câu được đánh dấu.",
};

export const GENDER_LABELS: Record<Gender, string> = {
  MALE: "Nam",
  FEMALE: "Nữ",
  OTHER: "Khác",
  PREFER_NOT_TO_SAY: "Không muốn nói",
};

export interface TargetingInput {
  limited: boolean;
  ageMin: string;
  ageMax: string;
  genders: Gender[];
}

/**
 * Step 2 "Đối tượng": `targetingJson` (VERIFIED `surveyTargetingSchema`; `{}`
 * = open to everyone). Only age and gender are offered here (ASSUMED scope:
 * Figma page 13 does not draw this step).
 */
export function buildTargeting(input: TargetingInput): { ok: true; value: SurveyTargetingCriteria } | { ok: false; error: string } {
  if (!input.limited) return { ok: true, value: {} };
  const criteria: SurveyTargetingCriteria = {};
  if (input.ageMin.trim() || input.ageMax.trim()) {
    const min = Number(input.ageMin || 13);
    const max = Number(input.ageMax || 100);
    criteria.ageRange = { min, max };
  }
  if (input.genders.length > 0) criteria.genders = [...input.genders];
  const parsed = surveyTargetingSchema.safeParse(criteria);
  if (!parsed.success) return { ok: false, error: "Độ tuổi phải là số nguyên từ 13 đến 100, tuổi nhỏ nhất không lớn hơn tuổi lớn nhất." };
  return { ok: true, value: parsed.data };
}
