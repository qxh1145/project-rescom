import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

export function PayosTopUpCompactCard() {
  return (
    <section
      aria-labelledby="payos-topup-card-title"
      className="hidden flex-col rounded-card border border-line bg-surface p-5 lg:flex shadow-xs"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-tone-amber-bg text-tone-amber-fg">
          <Icon name="points-coin" size={20} />
        </span>
        <div className="flex flex-col">
          <h2 id="payos-topup-card-title" className="text-body font-bold text-ink">
            Nạp điểm qua PayOS
          </h2>
          <span className="text-caption text-ink-muted">
            Quét mã VietQR tự động cộng điểm sau 5 giây
          </span>
        </div>
      </div>
      <Link
        href="/wallet/top-up"
        className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-field bg-tone-amber-accent text-body font-extrabold text-ink transition-[filter] hover:brightness-95"
      >
        <Icon name="plus" size={18} />
        Nạp điểm ngay
      </Link>
    </section>
  );
}
