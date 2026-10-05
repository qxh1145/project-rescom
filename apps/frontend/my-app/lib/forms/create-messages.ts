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
    case "FORM_DEADLINE_INVALID":
      return "Hạn thu thập đã quá gần hoặc quá xa. Chọn lại “Hạn thu thập” rồi gửi lại.";
    case "VALIDATION_ERROR":
    case "TARGETING_VALIDATION_ERROR":
      return "Thông tin khảo sát chưa hợp lệ. Kiểm tra lại các bước rồi thử lại.";
    default:
      if (isIdempotencyConflict(error)) return IDEMPOTENCY_CONFLICT_MESSAGE;
      return SUBMIT_FALLBACK;
  }
}

const IDEMPOTENCY_CONFLICT_MESSAGE =
  "Lần gửi trước của bản nháp này đã được ghi nhận với thông tin khác. Hãy kiểm tra danh sách khảo sát của bạn (“Khảo sát của tôi”): khảo sát có thể đã được tạo.";

/** Backend 409 for an `Idempotency-Key` reused with a different body (exact code not final: any `IDEMPOTENCY*` code). */
function isIdempotencyConflict(error: unknown): boolean {
  return isApiError(error) && error.status === 409 && typeof error.code === "string" && error.code.includes("IDEMPOTENCY");
}

/**
 * Decision C6 (a): keep the draft's `Idempotency-Key` only when the outcome of
 * `POST /forms/external` is unknown (no response, 5xx, 429), so the retry is
 * replayed by the server instead of creating a second survey and escrow. Any
 * other answer is final: the next submit (maybe with edited fields) is a new
 * request with a new key. Review MEDIUM-4: an `IDEMPOTENCY*` conflict keeps
 * the key too — the survey may already exist, so the Publisher checks the
 * list instead of sending a second, different survey under a fresh key.
 */
export function keepsIdempotencyKey(error: unknown): boolean {
  if (!isApiError(error)) return true;
  if (isIdempotencyConflict(error)) return true;
  // No response, or a 2xx body that did not parse: the survey may exist.
  if (error.kind === "network" || error.kind === "malformed") return true;
  return error.status === 429 || (typeof error.status === "number" && error.status >= 500);
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

/** "Sửa & gửi lại" (`?from=<id>`): the wizard was filled from the rejected survey. */
export const PREFILL_MESSAGES = {
  filled: (title: string) =>
    `Đã điền sẵn thông tin từ “${title}”. Sửa theo góp ý của Admin rồi gửi duyệt — Rescom tạo một khảo sát mới, khảo sát cũ giữ nguyên.`,
  replacedDraft: "Bản nháp Google Forms bạn đang soạn dở đã được thay bằng thông tin này.",
  notGoogleForms: "Khảo sát này tạo bằng Form Builder nên không điền sẵn vào mẫu Google Forms được.",
} as const;

/** `GET /forms/:id` failed while prefilling from `?from=<id>`. */
export function prefillErrorMessage(error: unknown): string {
  if (!isApiError(error)) return "Không tải được khảo sát cũ để điền sẵn. Vui lòng tải lại trang.";
  if (error.kind === "network") return NETWORK;
  if (error.code === "FORM_NOT_FOUND" || error.status === 404) return "Không tìm thấy khảo sát cũ để điền sẵn.";
  if (error.code === "FORM_FORBIDDEN" || error.status === 403) return "Khảo sát cũ thuộc tài khoản khác nên không điền sẵn được.";
  return "Không tải được khảo sát cũ để điền sẵn. Vui lòng tải lại trang.";
}
