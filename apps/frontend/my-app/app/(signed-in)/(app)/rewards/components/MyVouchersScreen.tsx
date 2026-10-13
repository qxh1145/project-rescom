"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { ButtonLink } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { IconLink } from "@/components/ui/IconButton";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useApiQuery } from "@/lib/api/use-api-query";
import { expiringNotice, myVouchersSubtitle, parseVoucherTab, type VoucherTab } from "@/lib/rewards/my-vouchers";
import { listVouchers } from "@/lib/rewards/rewards-service";
import { formatPoints } from "@/lib/rewards/voucher-display";
import { useIsDesktop } from "@/components/product-tour/tour-dom";
import { useMyVouchers, useTicketsNow } from "../hooks/use-my-vouchers";
import { RedemptionHistory } from "./RedemptionHistory";
import { RewardsErrorState } from "./RewardsErrorState";
import { VoucherTicketCard } from "./VoucherTicketCard";

const TAB_EMPTY: Record<VoucherTab, string> = {
  unused: "Bạn không còn voucher chưa dùng.",
  used: "Chưa có voucher nào được đánh dấu đã dùng.",
  expired: "Không có voucher hết hạn.",
};

/** The tab lives in the URL (`?tab=used|expired`) so Back from a ticket returns to the same tab. */
function useVoucherTab() {
  const router = useRouter();
  const pathname = usePathname();
  const tab = parseVoucherTab(useSearchParams().get("tab"));
  const setTab = useCallback((next: VoucherTab) => router.replace(next === "unused" ? pathname : `${pathname}?tab=${next}`, { scroll: false }), [router, pathname]);
  return { tab, setTab };
}

function NoVouchers() {
  // Fetched only while this state shows. ponytail: first 50 vouchers only, enough for "đủ đổi N".
  const { data } = useApiQuery("rewards-my-vouchers-suggestion", useCallback((signal) => listVouchers("affordable=true&limit=50", signal), []));
  const affordable = data?.items.filter((item) => item.status === "AVAILABLE").length ?? 0;
  const line = !data ? "Xem các voucher đang có để đổi nhé." : affordable > 0 ? `Bạn đang có ${formatPoints(data.viewer.available)} điểm khả dụng, đủ đổi ${affordable} voucher. Xem ngay nhé!` : "Làm khảo sát để kiếm thêm điểm rồi quay lại đổi quà nhé.";
  return (
    <div className="flex flex-col items-center py-10 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/mascots/search.svg" alt="" width={120} height={120} />
      <h2 className="mt-4 text-title-sm font-bold text-ink">Bạn chưa có voucher nào</h2>
      <p className="mt-1 max-w-sm text-body text-ink-muted">{line}</p>
      <ButtonLink href="/rewards" size="base" className="mt-5">Đổi quà ngay</ButtonLink>
    </div>
  );
}

export function MyVouchersScreen() {
  const { tab, setTab } = useVoucherTab();
  const { data, error, reload, byTab, serverTime, unused } = useMyVouchers();
  const nowMs = useTicketsNow(serverTime);
  // Mounted (and fetched) only at lg: mobile links to /rewards/history instead.
  const desktop = useIsDesktop();
  const list = byTab?.[tab] ?? [];
  const notice = tab === "unused" && data ? expiringNotice(data.items) : null;
  return (
    <div className="min-h-full pb-24 lg:pb-12">
      <MobileBackBar title="Voucher của tôi" backHref="/rewards" action={<IconLink href="/rewards/history" icon="history" label="Lịch sử đổi điểm" />} />
      <main className="mx-auto max-w-7xl px-4 py-4 md:px-6 md:py-6 lg:px-8">
        <div className="mb-6 hidden lg:block">
          <h1 className="text-title font-extrabold text-ink">Voucher của tôi</h1>
          {data && <p className="mt-1 text-body-sm text-ink-muted">{myVouchersSubtitle(data.items)}</p>}
        </div>
        <div className="lg:grid lg:grid-cols-[560px_1fr] lg:items-start lg:gap-6">
          <div className="flex flex-col gap-4">
            {!data && !error && <div role="status" aria-label="Đang tải voucher" className="flex flex-col gap-3">{[0, 1, 2].map((i) => <div key={i} className="thought-skeleton h-[125px] rounded-[20px]" />)}</div>}
            {!data && error && <RewardsErrorState title="Chưa tải được voucher của bạn" onRetry={reload} />}
            {data && byTab && (data.items.length === 0 ? <NoVouchers /> : <>
              <SegmentedControl variant="bordered" fullWidth label="Lọc voucher" value={tab} onChange={setTab} segments={[
                { value: "unused", label: `Chưa dùng (${unused})` }, { value: "used", label: `Đã dùng (${byTab.used.length})` }, { value: "expired", label: `Hết hạn (${byTab.expired.length})` },
              ]} />
              {notice && <p className="flex items-start gap-2 rounded-[14px] bg-danger-soft p-3 text-body-sm text-danger"><Icon name="clock" size={18} className="mt-0.5" />{notice}</p>}
              {list.length === 0 ? <p className="py-8 text-center text-body-sm text-ink-muted">{TAB_EMPTY[tab]}</p> : <ul className="flex flex-col gap-3">{list.map((ticket) => <li key={ticket.id}><VoucherTicketCard ticket={ticket} nowMs={nowMs} href={`/rewards/my-vouchers/${encodeURIComponent(ticket.id)}`} /></li>)}</ul>}
              <Link href="/rewards/history" className="flex h-[50px] items-center gap-3 rounded-[16px] border border-line bg-surface px-4 font-semibold text-ink lg:hidden"><Icon name="history" size={20} /><span className="flex-1">Lịch sử đổi điểm</span><Icon name="chevron-right" size={18} /></Link>
            </>)}
          </div>
          {desktop && <RedemptionHistory />}
        </div>
      </main>
    </div>
  );
}
