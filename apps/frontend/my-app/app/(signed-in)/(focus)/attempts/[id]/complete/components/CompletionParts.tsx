"use client";

import Link from "next/link";
import { RescomLogo } from "@/components/brand/RescomLogo";
import { PointsChip } from "@/components/layout/app/PointsChip";
import { Icon } from "@/components/ui/Icon";

/** Figma 62:1763 — completion header: logo + points chip (no navigation). */
export function CompletionDesktopHeader() {
  return (
    <header className="relative z-20 hidden h-18.25 items-center border-b border-line bg-surface px-12 lg:flex">
      <Link href="/marketplace" aria-label="Rescom — Khám phá" className="mr-auto">
        <RescomLogo size="md" />
      </Link>
      <PointsChip variant="desktop" />
    </header>
  );
}

/** "+12 điểm vào Khả dụng" (Figma 62:1796 / 62:2051) — pending wording for Google Forms (ASSUMED, page 5). */
export function RewardPill({ amount, kind }: { amount: number; kind: "available" | "pending" }) {
  return (
    <p className="inline-flex h-9 items-center rounded-full bg-tone-amber-accent px-4 text-lead font-extrabold text-ink lg:h-11 lg:px-5 lg:text-body-lg">
      +{amount} điểm vào {kind === "pending" ? "Chờ duyệt 48 giờ" : "Khả dụng"}
    </p>
  );
}

/** "Tài khoản đã kích hoạt" (62:1798 desktop: white + teal border; 62:2078 mobile: teal fill). */
export function ActivationCard() {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-tone-teal-bg px-4 py-3.5 lg:w-[368px] lg:border lg:border-tone-teal-line lg:bg-surface lg:py-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-field bg-tone-teal-accent text-ink">
        <Icon name="unlock" size={20} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-body font-extrabold text-ink">Tài khoản đã kích hoạt</p>
        <p className="text-caption text-tone-teal-ink">100 điểm khởi đầu đã chuyển sang Khả dụng.</p>
      </div>
    </div>
  );
}
