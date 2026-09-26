import {
  checkPublishRewardBand,
  type FormTypeEnum,
  type RewardPricingRange,
} from "@rescom/schemas";

/**
 * Publisher-facing copy for the FR-14 reward pricing band (code-review
 * decision E6-D2). The band is picked from the estimated completion time and
 * enforced by the backend when a survey is published; drafts stay editable,
 * so this only warns while editing and blocks the publish action.
 */
export interface PricingBandHint {
  tone: "info" | "warning" | "error";
  message: string;
  /** True when the backend would refuse the publication. */
  blocksPublish: boolean;
  range: RewardPricingRange | null;
}

const DURATION_BAND_LABELS: Record<RewardPricingRange["durationBand"], string> = {
  "< 5 min": "dưới 5 phút",
  "5–10 min": "5–10 phút",
  "10–15 min": "10–15 phút",
  "> 15 min": "trên 15 phút",
};

export function durationBandLabel(band: RewardPricingRange["durationBand"]): string {
  return DURATION_BAND_LABELS[band] ?? band;
}

export function describePricingBand(input: {
  type: FormTypeEnum;
  rewardPerResponse: number;
  estimatedDurationMinutes: number | null | undefined;
}): PricingBandHint {
  const check = checkPublishRewardBand(input);
  switch (check.status) {
    case "EXEMPT":
      return {
        tone: "info",
        message: "Khảo sát miễn phí (0 điểm) không áp dụng khung giá thưởng.",
        blocksPublish: false,
        range: null,
      };
    case "DURATION_REQUIRED":
      return {
        tone: "warning",
        message:
          "Nhập thời gian hoàn thành dự kiến để xác định khung giá thưởng trước khi xuất bản.",
        blocksPublish: true,
        range: null,
      };
    case "OUT_OF_BAND":
      return {
        tone: "error",
        message: `Với thời gian ${durationBandLabel(check.range.durationBand)}, điểm thưởng phải từ ${check.range.min} đến ${check.range.max} điểm (gợi ý: ${check.range.suggested}). Bản nháp vẫn được lưu, nhưng cần điều chỉnh trước khi xuất bản.`,
        blocksPublish: true,
        range: check.range,
      };
    case "WITHIN_BAND":
      return {
        tone: "info",
        message: `Khung giá thưởng cho ${durationBandLabel(check.range.durationBand)}: ${check.range.min}–${check.range.max} điểm (gợi ý: ${check.range.suggested}).`,
        blocksPublish: false,
        range: check.range,
      };
  }
}

/**
 * Vietnamese message for the publish-time pricing errors of the backend
 * (400 PRICING_REWARD_OUT_OF_BAND with `{ min, max, suggested }`, 422
 * ESTIMATED_DURATION_REQUIRED), or null for any other error.
 */
export function pricingPublishErrorMessage(
  code: string | undefined,
  details: unknown,
): string | null {
  if (code === "ESTIMATED_DURATION_REQUIRED") {
    return "Hãy nhập thời gian hoàn thành dự kiến trước khi xuất bản khảo sát có thưởng.";
  }
  if (code === "PRICING_REWARD_OUT_OF_BAND") {
    const band = details as { min?: unknown; max?: unknown; suggested?: unknown } | null;
    if (
      band &&
      typeof band.min === "number" &&
      typeof band.max === "number" &&
      typeof band.suggested === "number"
    ) {
      return `Điểm thưởng nằm ngoài khung giá cho thời gian dự kiến: phải từ ${band.min} đến ${band.max} điểm (gợi ý: ${band.suggested}).`;
    }
    return "Điểm thưởng nằm ngoài khung giá cho thời gian dự kiến.";
  }
  return null;
}
