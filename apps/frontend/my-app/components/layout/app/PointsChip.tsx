"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { useSession } from "@/lib/session/SessionProvider";
import { headerPoints } from "@/lib/wallet/wallet-service";

interface PointsChipProps {
  /** Desktop 40px ("112 điểm" / "100 đóng băng"); mobile 36px, number only. */
  variant: "desktop" | "mobile";
}

/** Figma "Link – 112 điểm" (62:961) / "Link – 100" (62:1253): amber pill to the wallet. */
export function PointsChip({ variant }: PointsChipProps) {
  const { balance } = useSession();
  if (!balance) return null;
  const { kind, amount } = headerPoints(balance);
  const frozen = kind === "frozen";
  const text = variant === "mobile" ? String(amount) : frozen ? `${amount} đóng băng` : `${amount} điểm`;
  const label = frozen ? `${amount} điểm đang đóng băng: mở Ví điểm` : `${amount} điểm khả dụng: mở Ví điểm`;

  return (
    <Link
      href="/wallet"
      aria-label={label}
      className={[
        "inline-flex items-center gap-1.5 rounded-full bg-tone-amber-bg font-bold text-tone-amber-fg transition-colors hover:brightness-95",
        variant === "desktop" ? "h-10 px-3.5 text-label" : "h-9 px-3 text-label",
      ].join(" ")}
    >
      <Icon name={frozen ? "lock" : "points-coin"} size={16} />
      <span>{text}</span>
    </Link>
  );
}
