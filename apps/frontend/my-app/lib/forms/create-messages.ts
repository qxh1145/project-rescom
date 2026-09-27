import { EXTERNAL_SURVEY_URL_MAX_LENGTH, MAX_EXPECTED_COMPLETIONS } from "@rescom/schemas";
import { isApiError } from "../api/api-error.ts";

/**
 * Vietnamese copy of the Google Forms creation wizard (Figma 9a–9d). Error
 * codes: backend `forms.controller.ts` → `forms.service.ts#createExternalSurvey`,
 * `form-publishability.ts`, `economy.exceptions.ts`, `ZodValidationPipe`.
 */

const NETWORK = "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.";

export const CREATE_MESSAGES = {
  urlRequired: "Vui lòng dán link Google Forms.",
  urlTooLong: `Link không được vượt quá ${EXTERNAL_SURVEY_URL_MAX_LENGTH} ký tự.`,
  urlNotHttps: "Link phải dùng HTTPS (bắt đầu bằng https://).",
  urlNotGoogleForms:
    "Chỉ nhận link Google Forms (docs.google.com/forms/…, forms.gle/… hoặc forms.google.com/…).",
  urlInvalid: "Link chưa đúng định dạng (ví dụ: https://forms.gle/…).",
  urlValid: "Đúng định dạng link Google Forms",
  urlPublicHint: "Để form ở chế độ ai có link cũng mở được, không bắt đăng nhập tài khoản trường.",
  titleRequired: "Vui lòng nhập tiêu đề khảo sát.",
  titleTooLong: (max: number) => `Tiêu đề tối đa ${max} ký tự.`,
  descriptionTooLong: (max: number) => `Mô tả tối đa ${max} ký tự.`,
  durationRequired: "Chọn thời gian làm ước tính.",
  criteriaRequired: "Chọn ít nhất 1 tiêu chí.",
  ageIncomplete: "Nhập đủ tuổi từ và đến.",
  ageOutOfRange: "Độ tuổi phải là số nguyên từ 13 đến 100.",
  ageOrder: "Tuổi bắt đầu phải nhỏ hơn hoặc bằng tuổi kết thúc.",
  sampleInvalid: `Số người trả lời phải là số nguyên từ 1 đến ${MAX_EXPECTED_COMPLETIONS.toLocaleString("vi-VN")}.`,
  rewardOutOfBand: (min: number, max: number) => `Điểm thưởng mỗi lượt phải từ ${min} đến ${max} điểm.`,
} as const;

const SUBMIT_FALLBACK = "Chưa gửi được khảo sát. Vui lòng thử lại.";

/**
 * `POST /forms/external` failures. A 409 `INSUFFICIENT_ESCROW_BALANCE` is
 * shown as the 9c' "không đủ điểm" panel (`isInsufficientBalanceError`), not
 * as this message.
 */
export function createSurveyErrorMessage(error: unknown): string {
  if (!isApiError(error)) return SUBMIT_FALLBACK;
  if (error.kind === "network") return NETWORK;
  if (error.status === 429) return "Bạn thao tác quá nhanh. Vui lòng thử lại sau ít phút.";
  switch (error.code) {
    case "PRICING_REWARD_OUT_OF_BAND": {
      const band = bandDetails(error.details);
      return band
        ? `Điểm thưởng mỗi lượt phải từ ${band.min} đến ${band.max} điểm với thời gian đã chọn (gợi ý ${band.suggested}).`
        : "Điểm thưởng mỗi lượt nằm ngoài khung giá của thời gian đã chọn.";
    }
    case "ESTIMATED_DURATION_REQUIRED":
      return CREATE_MESSAGES.durationRequired;
    case "SURVEY_DURATION_EXCEEDS_RESERVATION":
      return "Khảo sát dài hơn 30 phút chưa được hỗ trợ. Chọn thời gian làm ngắn hơn.";
    case "INSUFFICIENT_BALANCE":
    case "INSUFFICIENT_ESCROW_BALANCE":
      return "Số dư không đủ để khoá ký quỹ cho khảo sát này.";
    case "VALIDATION_ERROR":
    case "TARGETING_VALIDATION_ERROR":
      return "Thông tin khảo sát chưa hợp lệ. Kiểm tra lại các bước rồi thử lại.";
    default:
      return SUBMIT_FALLBACK;
  }
}

/** Backend `InsufficientEscrowBalanceException` (409, `{ availableBalance, requiredAmount }`). */
export function isInsufficientBalanceError(error: unknown): boolean {
  return (
    isApiError(error) &&
    (error.code === "INSUFFICIENT_ESCROW_BALANCE" || error.code === "INSUFFICIENT_BALANCE")
  );
}

function bandDetails(details: unknown): { min: number; max: number; suggested: number } | null {
  if (typeof details !== "object" || details === null) return null;
  const { min, max, suggested } = details as Record<string, unknown>;
  return typeof min === "number" && typeof max === "number" && typeof suggested === "number"
    ? { min, max, suggested }
    : null;
}

/** Figma 9d: the line the publisher pastes into the form's confirmation message. */
export function completionCodeLine(code: string): string {
  return `Mã hoàn thành Rescom: ${code}`;
}
