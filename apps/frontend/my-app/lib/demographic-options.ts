import type { Gender } from "@rescom/schemas";

/**
 * Option catalogs of the Mandatory Demographic Survey wizard (Story 7.1,
 * FR-6). Pure module (no React/Next imports) so the wizard, the mock fixtures
 * and tests share one list. Server-side catalog validation is deferred
 * (values are free strings on the API), so a saved value outside these lists
 * is still valid and must stay visible in the wizard (code review P9).
 */

export const VIETNAM_LOCATIONS = [
  "Đà Nẵng",
  "Hà Nội",
  "TP. Hồ Chí Minh",
  "Cần Thơ",
  "Hải Phòng",
  "Thừa Thiên Huế",
  "Quảng Nam",
  "Bình Dương",
  "Đồng Nai",
  "Khác",
] as const;

export const FIELDS_OF_STUDY = [
  "Công nghệ thông tin",
  "Kinh tế & Quản trị kinh doanh",
  "Marketing & Truyền thông",
  "Kỹ thuật & Kiến trúc",
  "Ngôn ngữ & Khoa học xã hội",
  "Thiết kế đồ họa & Mỹ thuật đa phương tiện",
  "Y sinh & Sức khỏe",
  "Khác",
] as const;

export const OCCUPATIONS = [
  "Sinh viên đại học",
  "Học viên sau đại học",
  "Giảng viên / Nghiên cứu viên",
  "Nhân viên văn phòng",
  "Lao động tự do (Freelancer)",
  "Khác",
] as const;

export const INCOME_RANGES = [
  "Dưới 5 triệu VNĐ/tháng",
  "5 - 10 triệu VNĐ/tháng",
  "10 - 20 triệu VNĐ/tháng",
  "Trên 20 triệu VNĐ/tháng",
] as const;

/** FR-6: interests are a multi-select from 17+ categories. */
export const INTEREST_OPTIONS = [
  "Trí tuệ nhân tạo (AI)",
  "Công nghệ & Lập trình",
  "Khởi nghiệp & Kinh doanh",
  "Tài chính & Đầu tư",
  "Marketing & Mạng xã hội",
  "Giáo dục & Kỹ năng học tập",
  "Du lịch & Ẩm thực",
  "Thể thao & Rèn luyện sức khỏe",
  "Tâm lý học đường",
  "Sức khỏe tinh thần",
  "Tiêu dùng xanh & Bảo vệ môi trường",
  "Nghệ thuật & Âm nhạc",
  "Thời trang & Làm đẹp",
  "Trò chơi điện tử & Thể thao điện tử",
  "Phim ảnh & Giải trí",
  "Việc làm & Phát triển sự nghiệp",
  "Tình nguyện & Hoạt động cộng đồng",
  "Nghiên cứu khoa học",
] as const;

export const GENDER_OPTIONS: readonly { value: Gender; label: string }[] = [
  { value: "MALE", label: "Nam" },
  { value: "FEMALE", label: "Nữ" },
  { value: "OTHER", label: "Khác" },
  { value: "PREFER_NOT_TO_SAY", label: "Không chia sẻ" },
];

/**
 * The select's options plus a saved value that is not in the catalog, so the
 * wizard shows the profile actually being submitted instead of a placeholder.
 */
export function withSavedOption(
  catalog: readonly string[],
  saved: string | null | undefined,
): string[] {
  const value = saved?.trim();
  if (!value || catalog.includes(value)) return [...catalog];
  return [...catalog, value];
}

/**
 * The interest chips plus saved interests outside the catalog (shown as
 * selected, removable chips instead of being submitted invisibly).
 */
export function withSavedOptions(
  catalog: readonly string[],
  saved: readonly string[],
): string[] {
  const extra = saved.filter(
    (item, index) => item.trim() !== "" && !catalog.includes(item) && saved.indexOf(item) === index,
  );
  return [...catalog, ...extra];
}
