"use client";

import Link from "next/link";
import { useState } from "react";
import { PackageOptions } from "@/app/(signed-in)/(focus)/wallet/top-up/components/PackageOptions";
import { useCreateTopUp } from "@/app/(signed-in)/(focus)/wallet/top-up/hooks/use-create-top-up";
import { Alert } from "@/components/ui/Alert";
import { Spinner } from "@/components/ui/Spinner";
import { TOP_UP_MIN_POINTS, TOP_UP_PACKAGES } from "@/lib/wallet/top-up";

/**
 * Figma 7 desktop "Nạp điểm" card (62:284). "Xem thông tin chuyển khoản"
 * creates the request and opens 14b, like 14a's CTA. Mobile reaches the same
 * flow through "Nạp điểm" on the balance card.
 */
export function TopUpCard() {
  const [points, setPoints] = useState<number>(TOP_UP_PACKAGES[0]);
  const { create, submitting, error, resumeHref } = useCreateTopUp();

  return (
    <section
      aria-labelledby="wallet-top-up-title"
      className="hidden flex-col rounded-card border border-line bg-surface p-6 lg:flex"
    >
      <h2 id="wallet-top-up-title" className="text-[18px] font-extrabold text-ink">
        Nạp điểm
      </h2>
      <p className="mt-1 text-caption text-ink-muted">Chuyển khoản rồi gửi yêu cầu, Admin duyệt thủ công.</p>
      <div className="mt-4">
        <PackageOptions name="wallet-top-up-package" legend="Chọn gói nạp" value={points} onChange={setPoints} size="compact" />
      </div>
      {error ? (
        <Alert tone="danger" className="mt-4">
          {error}
          {resumeHref ? (
            <>
              {" "}
              <Link href={resumeHref} className="font-bold underline">
                Xem yêu cầu đang chờ
              </Link>
            </>
          ) : null}
        </Alert>
      ) : null}
      <button
        type="button"
        onClick={() => create(points)}
        disabled={submitting}
        aria-busy={submitting || undefined}
        className="mt-4 inline-flex h-12 items-center justify-center gap-2.5 rounded-field bg-tone-amber-accent text-body font-extrabold text-ink transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {submitting ? <Spinner /> : null}
        {submitting ? "Đang tạo yêu cầu…" : "Xem thông tin chuyển khoản"}
      </button>
      <p className="mt-4 text-[12px] leading-[18px] text-ink-muted">
        Tối thiểu {TOP_UP_MIN_POINTS} điểm. Điểm không quy đổi ngược ra tiền và không chuyển cho tài khoản khác.
      </p>
    </section>
  );
}
