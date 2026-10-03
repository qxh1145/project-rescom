/** Vietnamese copy for starting/resuming a survey (Khám phá card, consent screen). */
export const START_FLOW_MESSAGES = {
  alreadyCompleted: "Bạn đã hoàn thành khảo sát này rồi. Mỗi khảo sát chỉ làm được một lần.",
  notAvailable: "Khảo sát này không còn nhận câu trả lời. Hãy chọn khảo sát khác.",
  notEligible: "Khảo sát này dành cho nhóm người tham gia khác với hồ sơ của bạn.",
  ownSurvey: "Bạn không thể tự làm khảo sát do mình đăng.",
  rateLimited: "Bạn thao tác hơi nhanh. Vui lòng đợi một chút rồi thử lại.",
  /** 429 PARTICIPATION_RATE_LIMITED, scope COMPLETIONS (decision E8-D6). */
  completionsLimited: (input: { limit: number; windowMinutes: number; retryAfter: string; inProgress: number }) =>
    input.inProgress > 0
      ? `Bạn đã đạt giới hạn ${input.limit} khảo sát trong ${input.windowMinutes} phút (tính cả ${input.inProgress} khảo sát đang làm dở). Hãy hoàn thành khảo sát đang mở, hoặc thử lại sau ${input.retryAfter}.`
      : `Bạn đã hoàn thành tối đa ${input.limit} khảo sát trong ${input.windowMinutes} phút. Hãy thử lại sau ${input.retryAfter}.`,
  /**
   * 409 COMPLETION_CODE_LIMIT_REACHED on start (decision E5-D1). ASSUMED (design) copy,
   * same meaning as the Google Forms "account-limit" screen.
   */
  codeLimitReached:
    "Bạn đã nhập sai mã hoàn thành quá nhiều lần ở khảo sát này nên Rescom tạm dừng lượt làm mới trên tài khoản của bạn. Nếu bạn đã làm thật, hãy báo Admin để được kiểm tra và mở lại.",
  network: "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.",
  generic: "Chưa bắt đầu được khảo sát. Vui lòng thử lại.",
} as const;
