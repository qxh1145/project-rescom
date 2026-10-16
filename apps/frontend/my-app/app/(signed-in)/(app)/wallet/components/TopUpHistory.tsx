"use client";

import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { formatPoints, formatVnd } from "@/lib/wallet/top-up";
import {
  MANUAL_REFUNDED_COPY,
  type HistoryTopUp,
} from "@/lib/wallet/top-up-history";
import { TopUpStatusChip } from "@/components/wallet/TopUpStatusChip";

interface TopUpHistoryProps {
  items: HistoryTopUp[];
  loading: boolean;
  error: string | null;
  partialError: string | null;
  onRetry: () => void;
}

export function TopUpHistory({
  items,
  loading,
  error,
  partialError,
  onRetry,
}: TopUpHistoryProps) {
  return (
    <section
      aria-labelledby="topup-history-title"
      className="flex flex-col rounded-card border border-line bg-surface p-5 lg:p-6 shadow-xs"
    >
      <div className="flex items-center justify-between">
        <h2 id="topup-history-title" className="text-body font-bold text-ink">
          Lịch sử nạp điểm
        </h2>
      </div>

      {partialError && (
        <Alert tone="info" className="mt-3 text-caption">
          {partialError}
        </Alert>
      )}

      {error ? (
        <div className="mt-4 flex flex-col items-center gap-3 py-6">
          <Alert tone="danger">{error}</Alert>
          <Button variant="secondary" size="base" radius="field" onClick={onRetry}>
            Thử lại
          </Button>
        </div>
      ) : loading ? (
        <div
          role="status"
          aria-label="Đang tải lịch sử nạp..."
          className="flex items-center justify-center gap-2 py-8 text-caption text-ink-muted"
        >
          <Spinner className="size-4 text-primary" />
          <span>Đang tải lịch sử nạp…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center text-caption text-ink-muted">
          Chưa có giao dịch nạp điểm nào.
        </div>
      ) : (
        <div className="mt-4 divide-y divide-line">
          {items.map((item) => {
            const href = `/wallet/top-up/${encodeURIComponent(item.id)}`;
            const isManualRefunded = item.status === "MANUAL_REFUNDED";

            return (
              <div
                key={item.id}
                className="flex flex-col gap-1.5 py-3.5 first:pt-0 last:pb-0"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <Link
                        href={href}
                        className="text-body-sm font-bold text-ink hover:text-primary transition-colors"
                      >
                        Mã: {item.code}
                      </Link>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                        {item.channel === "PAYOS" ? "PayOS" : "Thủ công (cũ)"}
                      </span>
                    </div>
                    <span className="text-[11px] text-ink-muted">
                      {new Date(item.createdAt).toLocaleString("vi-VN")}
                    </span>
                  </div>

                  <div className="flex flex-col items-end gap-1">
                    <TopUpStatusChip chip={item.chip} />
                    {item.status === "SUCCESSFUL" || item.status === "APPROVED" ? (
                      <span className="text-body-sm font-extrabold text-ink">
                        +{formatPoints(item.points)} điểm
                      </span>
                    ) : (
                      <span className="text-[11px] text-ink-muted">
                        {item.status === "PROCESSING" || item.status === "PENDING"
                          ? `Dự kiến ${formatPoints(item.points)} điểm`
                          : "Không cộng điểm"}
                      </span>
                    )}
                    <span className="text-[11px] text-ink-muted">
                      {formatVnd(item.amountVnd)}
                    </span>
                  </div>
                </div>

                {isManualRefunded && (
                  <p className="rounded-lg bg-teal-50/70 p-2 text-[11px] leading-relaxed text-teal-900 border border-teal-100">
                    {MANUAL_REFUNDED_COPY}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
