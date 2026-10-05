import type { Gender } from "@rescom/schemas";

/**
 * Option catalogs of the Mandatory Demographic Survey wizard (Story 7.1,
 * FR-6). Pure module (no React/Next imports) so the wizard, the mock fixtures
 * and tests share one list. Server-side catalog validation is deferred
 * (values are free strings on the API), so a saved value outside these lists
 * is still valid and must stay visible in the wizard (code review P9).
 */

/**
 * Onboarding 12.4 searches every province. ASSUMED: the 63 pre-2025 provinces,
 * the naming Figma uses ("Thừa Thiên Huế", "Quảng Nam"); stored as free text.
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
  "An Giang",
  "Bà Rịa – Vũng Tàu",
  "Bạc Liêu",
  "Bắc Giang",
  "Bắc Kạn",
  "Bắc Ninh",
  "Bến Tre",
  "Bình Định",
  "Bình Phước",
  "Bình Thuận",
  "Cà Mau",
  "Cao Bằng",
  "Đắk Lắk",
  "Đắk Nông",
  "Điện Biên",
  "Đồng Tháp",
  "Gia Lai",
  "Hà Giang",
  "Hà Nam",
  "Hà Tĩnh",
  "Hải Dương",
  "Hậu Giang",
  "Hòa Bình",
  "Hưng Yên",
  "Khánh Hòa",
  "Kiên Giang",
  "Kon Tum",
  "Lai Châu",
  "Lâm Đồng",
  "Lạng Sơn",
  "Lào Cai",
  "Long An",
  "Nam Định",
  "Nghệ An",
  "Ninh Bình",
  "Ninh Thuận",
  "Phú Thọ",
  "Phú Yên",
  "Quảng Bình",
  "Quảng Ngãi",
  "Quảng Ninh",
  "Quảng Trị",
  "Sóc Trăng",
  "Sơn La",
  "Tây Ninh",
  "Thái Bình",
  "Thái Nguyên",
  "Thanh Hóa",
  "Tiền Giang",
  "Trà Vinh",
  "Tuyên Quang",
  "Vĩnh Long",
  "Vĩnh Phúc",
  "Yên Bái",
  "Khác",
] as const;

/** Figma 12.4: shown before the user types a search. */
export const POPULAR_LOCATIONS = [
  "Đà Nẵng",
  "Hà Nội",
  "TP. Hồ Chí Minh",
  "Thừa Thiên Huế",
  "Quảng Nam",
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
  // Decision 2026-09-26: income stays required (FR-6) but is sensitive, so the
  // user may decline. Same wording as the gender opt-out. If income targeting is
  // ever approved (PRD Open Question 13), this value must never match a bracket.
  "Không chia sẻ",
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

/** Figma 12.5: these occupations also answer 12.6 (school) and 12.7 (school year). */
export const STUDENT_OCCUPATIONS: readonly string[] = ["Sinh viên đại học", "Học viên sau đại học"];

/**
 * Figma 12.6 draws the four FPT campuses for the query "FPT". ASSUMED (design): the
 * rest of the catalog (no backend list yet); any other school is typed in.
 */
export const SCHOOL_OPTIONS = [
  "Trường Đại học FPT – Đà Nẵng",
  "Trường Đại học FPT – Hà Nội",
  "Trường Đại học FPT – TP. Hồ Chí Minh",
  "Trường Đại học FPT – Cần Thơ",
  "Trường Đại học FPT – Quy Nhơn",
  "Trường Đại học Bách khoa – Đại học Đà Nẵng",
  "Trường Đại học Kinh tế – Đại học Đà Nẵng",
  "Trường Đại học Sư phạm – Đại học Đà Nẵng",
  "Trường Đại học Duy Tân",
  "Đại học Quốc gia Hà Nội",
  "Đại học Bách khoa Hà Nội",
  "Trường Đại học Kinh tế Quốc dân",
  "Trường Đại học Ngoại thương",
  "Học viện Công nghệ Bưu chính Viễn thông",
  "Đại học Quốc gia TP. Hồ Chí Minh",
  "Trường Đại học Bách khoa – ĐHQG TP. Hồ Chí Minh",
  "Đại học Kinh tế TP. Hồ Chí Minh",
  "Trường Đại học RMIT Việt Nam",
  "Trường Đại học Cần Thơ",
  "Đại học Huế",
] as const;

/**
 * Figma 12.7. `value` is what `/users/me/profile.schoolYear` stores
 * (`SCHOOL_YEAR_VALUES` in @rescom/schemas; a test keeps the two lists equal);
 * mobile spells out the last option ("Năm 5 trở lên").
 */
export const SCHOOL_YEAR_OPTIONS: readonly { value: string; label: string; longLabel: string }[] = [
  { value: "Năm 1", label: "Năm 1", longLabel: "Năm 1" },
  { value: "Năm 2", label: "Năm 2", longLabel: "Năm 2" },
  { value: "Năm 3", label: "Năm 3", longLabel: "Năm 3" },
  { value: "Năm 4", label: "Năm 4", longLabel: "Năm 4" },
  { value: "Năm 5+", label: "Năm 5+", longLabel: "Năm 5 trở lên" },
];

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
