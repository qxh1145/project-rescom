import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { formatPoints } from "@/lib/rewards/voucher-display";

interface BalanceCardProps {
  /** null while the balance is unknown (loading or failed): never shown as 0. */
  available: number | null;
  pending?: number;
  className?: string;
}

export function BalanceCard({ available, pending = 0, className = "" }: BalanceCardProps) {
  return (
    <div
      className={[
        "relative overflow-hidden rounded-[18px] bg-tone-amber-bg p-5",
        className,
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-caption font-medium text-tone-amber-fg">
            <span>Điểm khả dụng</span>
            <Icon name="info" size={14} />
          </div>
          {available === null ? (
            <div className="thought-skeleton h-9 w-28 rounded-[8px]" role="status" aria-label="Đang tải số dư" />
          ) : (
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-extrabold tracking-tight text-primary-strong">
                {formatPoints(available)}
              </span>
              <span className="text-body font-semibold text-tone-amber-fg">điểm</span>
            </div>
          )}
        </div>

        {/* Mascot artwork: mobile only (Figma desktop 122:421 has none) */}
        <div className="relative h-14 w-14 shrink-0 lg:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/mascots/points.svg"
            alt=""
            className="h-full w-full object-contain"
          />
        </div>
      </div>

      <p className="mt-2 text-caption text-tone-amber-fg">
        Dùng được cả điểm nạp.
        {pending > 0 ? ` ${formatPoints(pending)} điểm chờ duyệt chưa được tính.` : ""}
      </p>

      <div className="mt-3 border-t border-tone-amber-track pt-3">
        <Link
          href="/marketplace"
          className="inline-flex items-center gap-1 text-label font-bold text-primary-strong hover:underline"
        >
          <span>Làm khảo sát để kiếm thêm</span>
          <Icon name="chevron-right" size={16} />
        </Link>
      </div>
    </div>
  );
}
