import { isApiError } from "../api/api-error.ts";

/**
 * Vietnamese copy of the onboarding flow. The interests message is Figma
 * 12.10' (63:1097); the others are ASSUMED (not drawn).
 */
export const ONBOARDING_MESSAGES = {
  nameRequired: "Nhập tên bạn muốn Rescom dùng.",
  nameTooLong: "Tên hiển thị tối đa 50 ký tự.",
  birthYearRequired: "Nhập năm sinh của bạn.",
  birthYearFormat: "Năm sinh gồm 4 chữ số, ví dụ 2005.",
  birthYearFuture: "Năm sinh không thể ở tương lai.",
  tooYoung: "Rescom dành cho người từ 13 tuổi trở lên.",
  tooOld: "Năm sinh chưa hợp lệ. Bạn kiểm tra lại giúp nhé.",
  genderRequired: "Chọn một lựa chọn, hoặc “Không chia sẻ”.",
  locationRequired: "Chọn tỉnh/thành bạn đang sống.",
  occupationRequired: "Chọn công việc hiện tại của bạn.",
  schoolRequired: "Chọn hoặc nhập tên trường của bạn.",
  schoolYearRequired: "Chọn năm học hiện tại của bạn.",
  fieldRequired: "Chọn ngành học gần nhất với bạn.",
  incomeRequired: "Chọn một mức, hoặc “Không chia sẻ”.",
  interestsTooMany: "Chọn tối đa 30 chủ đề.",
  goalRequired: "Chọn mục tiêu của bạn để hoàn tất.",
  submitInvalid: "Câu trả lời này chưa hợp lệ. Bạn kiểm tra lại giúp nhé.",
  submitNetwork: "Không kết nối được máy chủ. Kiểm tra mạng rồi bấm Hoàn tất lần nữa.",
  submitFailed: "Chưa lưu được hồ sơ. Vui lòng thử lại sau ít phút.",
  loadFailed: "Không tải được hồ sơ của bạn.",
} as const;

/** Figma 12.10': "Chọn thêm 2 chủ đề nữa để tiếp tục (tối thiểu 3)." */
export function interestsShortfallMessage(missing: number, minimum: number): string {
  return `Chọn thêm ${missing} chủ đề nữa để tiếp tục (tối thiểu ${minimum}).`;
}

/** Copy for a failed final submit (validation errors are routed to their step by the caller). */
export function onboardingSubmitErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.kind === "network") return ONBOARDING_MESSAGES.submitNetwork;
    if (error.kind === "http" && error.status === 400) return ONBOARDING_MESSAGES.submitInvalid;
  }
  return ONBOARDING_MESSAGES.submitFailed;
}
