"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { formatVnd } from "@/lib/wallet/top-up";
import type { HistoryTopUp } from "@/lib/wallet/top-up-history";

interface ProcessingBannerProps {
  topUp: HistoryTopUp;
}

export function ProcessingBanner({ topUp }: ProcessingBannerProps) {
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 rounded-2xl border border-tone-amber-accent/40 bg-tone-amber-bg px-4 py-3 text-ink shadow-xs"
    >
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-tone-amber-accent/20 text-tone-amber-fg shrink-0">
          <Icon name="hourglass" size={16} />
        </span>
        <div className="text-body-sm">
          <span>Giao dịch nạp </span>
          <span className="font-bold">{formatVnd(topUp.amountVnd)}</span>
          <span> đang chờ thanh toán</span>
        </div>
      </div>
      <Link
        href={`/wallet/top-up/${encodeURIComponent(topUp.id)}`}
        className="inline-flex shrink-0 items-center justify-center rounded-field bg-surface px-3 py-1.5 text-caption font-bold text-primary shadow-xs hover:bg-slate-50 transition-colors"
      >
        Xem chi tiết
      </Link>
    </div>
  );
}
