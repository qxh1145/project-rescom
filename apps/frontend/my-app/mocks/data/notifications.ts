import type { NotificationDto } from "@rescom/schemas";
import { createCollection, hoursAgo, mockId } from "../db/store";

/**
 * Seed = Figma 14d "Trung tâm thông báo" (62:2117). The backend DTO only has
 * `type` + `message`; the Figma title is the first sentence of `message`
 * (split on " — "), see `lib/notifications`.
 */
function seed(): NotificationDto[] {
  const item = (
    type: NotificationDto["type"],
    message: string,
    hours: number,
    isRead: boolean,
  ): NotificationDto => ({
    id: mockId(),
    type,
    message,
    isRead,
    createdAt: hoursAgo(hours),
    readAt: isRead ? hoursAgo(hours - 0.5) : null,
  });
  return [
    item(
      "ESCROW_RELEASED",
      "Khiếu nại được chấp nhận — Lượt làm của #7F3A trong “Thói quen đọc sách của sinh viên” không hợp lệ. 10 điểm đã hoàn vào Khả dụng của bạn.",
      1,
      false,
    ),
    item(
      "REWARD_PENDING",
      "+18 điểm đang chờ 48 giờ — Từ “Thói quen dùng AI trong học tập…”. Còn 31 giờ trước khi vào Khả dụng.",
      6,
      false,
    ),
    item("REWARD_RELEASED", "+12 điểm vào Khả dụng — Từ “Hành vi mua sắm online của sinh viên Đà Nẵng”.", 7, false),
    item(
      "ACCOUNT_ACTIVATED",
      "Tài khoản đã kích hoạt — 100 điểm khởi đầu đã mở khoá. Bạn có thể dùng để đăng khảo sát.",
      7,
      true,
    ),
    item(
      "SURVEY_APPROVED",
      "Khảo sát đã đủ mẫu — “Nhu cầu nhà trọ gần trường” đủ 20/20 và đã ẩn khỏi Khám phá. Xem câu trả lời.",
      5 * 24,
      true,
    ),
    item(
      "SURVEY_REJECTED",
      "Khảo sát bị từ chối — “Trải nghiệm dùng app giao đồ ăn”: form yêu cầu đăng nhập tài khoản trường. Đã hoàn 120 điểm.",
      6 * 24,
      true,
    ),
    item(
      "WARNING",
      "Yêu cầu nạp điểm chưa được duyệt — Không tìm thấy giao dịch khớp nội dung RESCOM LN5820. Nếu bạn đã chuyển, hãy liên hệ hỗ trợ.",
      7 * 24,
      true,
    ),
  ];
}

/** Keyed by user id; every user gets the same seed on first read. */
export const notifications = createCollection<Record<string, NotificationDto[]>>("notifications", () => ({}));

export function notificationsOf(userId: string): NotificationDto[] {
  const existing = notifications.get()[userId];
  if (existing) return existing;
  const seeded = seed();
  notifications.update((all) => {
    all[userId] = seeded;
  });
  return seeded;
}

export function updateNotifications(userId: string, mutator: (items: NotificationDto[]) => void): NotificationDto[] {
  notificationsOf(userId);
  return notifications.update((all) => {
    mutator(all[userId]);
  })[userId];
}
