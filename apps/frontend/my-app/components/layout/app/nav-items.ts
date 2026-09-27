import type { IconName } from "@/components/ui/Icon";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Other path prefixes that highlight this item. */
  match?: readonly string[];
}

/** Desktop header (Figma "Header" 62:955): three text links. */
export const DESKTOP_NAV: readonly NavItem[] = [
  { href: "/marketplace", label: "Khám phá", icon: "compass", match: ["/surveys", "/attempts"] },
  { href: "/forms", label: "Khảo sát của tôi", icon: "file-text" },
  { href: "/wallet", label: "Ví điểm", icon: "wallet" },
];

/** Mobile bottom nav (Figma "Nav" 62:1359): four tabs. */
export const MOBILE_NAV: readonly NavItem[] = [
  { href: "/marketplace", label: "Khám phá", icon: "compass", match: ["/surveys", "/attempts"] },
  { href: "/wallet", label: "Ví điểm", icon: "wallet" },
  { href: "/forms", label: "Đăng khảo sát", icon: "file-text" },
  { href: "/account", label: "Tài khoản", icon: "user", match: ["/notifications", "/leaderboard"] },
];

export function isNavActive(item: NavItem, pathname: string): boolean {
  const prefixes = [item.href, ...(item.match ?? [])];
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
