import { getRewardPricingRange, surveyTargetingSchema, type Gender, type SurveyTargetingCriteria } from "@rescom/schemas";
import { z } from "zod";

/**
 * Publish settings (builder steps 2 "Đối tượng" and 3 "Số mẫu & điểm") and
 * the FR-14 price hint "Giá gợi ý 8–16 điểm/lượt · rẻ hơn 20%" (Figma 13a):
 * the band of the estimated duration (`getRewardPricingRange`) at the 20 %
 * Internal-form discount (`calculateEscrowCost`).
 */

export const INTERNAL_DISCOUNT = 0.8;

export function internalPriceHint(minutes: number): { min: number; max: number; label: string } {
  const band = getRewardPricingRange(Math.max(1, minutes));
  const min = Math.round(band.min * INTERNAL_DISCOUNT);
  const max = Math.round(band.max * INTERNAL_DISCOUNT);
  return { min, max, label: `${min}–${max} điểm/lượt` };
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
    .max(1440, "Tối đa 1.440 phút."),
});
export type PublishSettings = z.infer<typeof publishSettingsSchema>;

export type PublishSettingsErrors = Partial<Record<keyof PublishSettings, string>>;

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
