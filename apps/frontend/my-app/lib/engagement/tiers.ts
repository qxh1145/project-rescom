/**
 * Member tiers (Figma 16 "Hạng thành viên", 63:4981). Tiers depend only on the
 * number of completed surveys — never on answer reliability (Figma note).
 */
export interface Tier {
  level: 1 | 2 | 3 | 4 | 5;
  name: string;
  /** How to reach it ("Từ 20 khảo sát"). */
  requirement: string;
  /** What it unlocks. */
  perk: string;
  /**
   * The same benefit as a verb phrase after "để …" ("Làm thêm 18 khảo sát để
   * được ưu tiên hiển thị trên Khám phá."). ASSUMED (design) copy.
   */
  unlockPhrase: string;
  /** Completed surveys needed; null for tiers gated by something else. */
  minSurveys: number | null;
}

export const TIERS: readonly Tier[] = [
  {
    level: 1,
    name: "Người dùng mới",
    requirement: "Vừa đăng ký",
    perk: "100 điểm khởi đầu (đóng băng)",
    unlockPhrase: "nhận 100 điểm khởi đầu",
    minSurveys: null,
  },
  {
    level: 2,
    name: "Thành viên xác thực",
    requirement: "Hoàn tất hồ sơ + làm 1 khảo sát",
    perk: "Mở khoá điểm, dùng đầy đủ tính năng",
    unlockPhrase: "mở khoá điểm và dùng đầy đủ tính năng",
    minSurveys: 1,
  },
  {
    level: 3,
    name: "Người đóng góp tích cực",
    requirement: "Từ 20 khảo sát",
    perk: "Được ưu tiên hiển thị trên Khám phá",
    unlockPhrase: "được ưu tiên hiển thị trên Khám phá",
    minSurveys: 20,
  },
  {
    level: 4,
    name: "Nhà nghiên cứu tin cậy",
    requirement: "Từ 100 khảo sát",
    perk: "Huy hiệu và quyền lợi của hạng. Điểm Google Forms vẫn chờ 48 giờ",
    unlockPhrase: "nhận huy hiệu và quyền lợi của hạng Nhà nghiên cứu tin cậy",
    minSurveys: 100,
  },
  {
    level: 5,
    name: "Đại sứ cộng đồng",
    requirement: "Từ 300 khảo sát",
    perk: "Huy hiệu",
    unlockPhrase: "nhận huy hiệu Đại sứ cộng đồng",
    minSurveys: 300,
  },
];

export function tierOf(level: number): Tier {
  return TIERS.find((tier) => tier.level === level) ?? TIERS[0];
}

/**
 * Progress toward the next tier ("2/20", "Còn 18 khảo sát nữa"). Null at the
 * top tier. Level 1 → 2 is gated by the profile, so it reports 0/1 surveys.
 */
export function nextTierProgress(
  level: number,
  completedSurveys: number,
): { next: Tier; current: number; target: number; remaining: number } | null {
  const next = TIERS.find((tier) => tier.level === level + 1);
  if (!next || next.minSurveys === null) return null;
  const target = next.minSurveys;
  const current = Math.min(completedSurveys, target);
  return { next, current, target, remaining: Math.max(target - completedSurveys, 0) };
}
