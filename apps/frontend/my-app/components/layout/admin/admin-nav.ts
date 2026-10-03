import { PILOT_BUILD } from "../../../lib/pilot-scope.ts";
import type { IconName } from "@/components/ui/Icon";
import type { AdminQueue } from "@/lib/admin/admin-queue-service";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Work queue whose count is shown as a red badge. */
  queue?: AdminQueue;
}

/** Figma 11 "Aside" (62:4071): console sections, in drawn order. */
export const ADMIN_NAV: readonly AdminNavItem[] = [
  { href: "/admin", label: "Tổng quan", icon: "layout-grid" },
  { href: "/admin/surveys", label: "Duyệt khảo sát", icon: "file-text", queue: "surveys" },
  { href: "/admin/top-ups", label: "Duyệt nạp điểm", icon: "wallet", queue: "topUps" },
  // Pilot: only the real "Báo thiếu mã" tab remains; on the real backend `queueCounts.disputes` is exactly the missing-code count.
  { href: "/admin/disputes", label: "Khiếu nại & báo lỗi", icon: "flag", queue: "disputes" },
  ...(PILOT_BUILD ? [] : [{ href: "/admin/quality", label: "Xét chất lượng", icon: "shield-check" as const, queue: "quality" as const }]),
  { href: "/admin/users", label: "Người dùng", icon: "users" },
  { href: "/admin/fraud-log", label: "FraudLog", icon: "shield-alert" },
  { href: "/admin/transactions", label: "Giao dịch", icon: "arrows-swap" },
];

/** `/admin` matches only itself; sections also match their detail pages. */
export function isAdminNavActive(item: AdminNavItem, pathname: string): boolean {
  if (item.href === "/admin") return pathname === "/admin";
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
