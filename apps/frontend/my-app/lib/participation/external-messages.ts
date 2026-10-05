/**
 * Vietnamese copy of the Google Forms flow (Figma page 5: 62:2, 62:359, 62:784,
 * 62:67). Strings not drawn in Figma are marked ASSUMED (design).
 */
export const EXTERNAL_MESSAGES = {
  // Figma 5b (62:784).
  wrongCodeTitle: (remainingTries: number) => `Mã chưa đúng · còn ${remainingTries} lần thử`,
  wrongCodeBody: "Mở lại trang cảm ơn cuối Google Form và chép đúng 6 chữ số.",
  // ASSUMED: the server clock is ahead of ours (422 SUBMISSION_TOO_FAST).
  tooFast: (countdown: string) => `Chưa đủ thời gian làm bài. Bạn có thể xác nhận mã sau ${countdown}.`,
  // ASSUMED (design) (not drawn).
  expired: "Lượt làm đã hết hạn giữ chỗ 30 phút. Hãy bắt đầu lại khảo sát.",
  notAvailable: "Khảo sát này không còn nhận câu trả lời.",
  alreadyCompleted: "Bạn đã hoàn thành khảo sát này rồi.",
  rateLimited: "Bạn thao tác hơi nhanh. Đợi một chút rồi thử lại nhé.",
  // ASSUMED: the same, when the 429 carries a Retry-After ("45 giây", "3 phút").
  rateLimitedFor: (wait: string) => `Bạn thao tác hơi nhanh. Thử lại sau ${wait} nhé.`,
  invalidFormat: "Mã hoàn thành gồm đúng 6 chữ số.",
  network: "Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.",
  generic: "Chưa xác nhận được mã. Vui lòng thử lại sau ít phút.",
  loadFailed: "Không tải được lượt làm khảo sát.",
  // ASSUMED (design) (not drawn): no link, or a link outside the Google Forms allowlist (never opened).
  formUrlMissing: "Khảo sát chưa có đường dẫn Google Form. Hãy báo Admin.",
  formUrlInvalid:
    "Đường dẫn của khảo sát này không phải liên kết Google Forms hợp lệ nên Rescom không mở. Hãy báo Admin kiểm tra.",
  notFound: "Không tìm thấy lượt làm này. Có thể nó đã hết hạn hoặc thuộc tài khoản khác.",

  // Report missing code dialog — ASSUMED (design) (not drawn).
  reportReasonTooShort: "Mô tả ngắn giúp Admin, tối thiểu 5 ký tự.",
  reportLocked:
    "Lượt làm đã bị khoá nên chưa gửi báo cáo được ở đây. Liên hệ hỗ trợ Rescom để Admin kiểm tra giúp bạn.",
  reportCompleted: "Lượt làm này đã được xác nhận, không cần báo thiếu mã.",
  reportExpired: "Lượt làm này đã bị huỷ nên không gửi báo cáo được.",
  reportFailed: "Chưa gửi được báo cáo. Vui lòng thử lại.",

  // Cancel dialog — ASSUMED (design) (not drawn).
  cancelFailed: "Chưa huỷ được lượt làm. Vui lòng thử lại.",
} as const;
