"use client";

import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Tag } from "@/components/ui/Tag";
import { historyRowView, monthSummaryLine, type HistoryRowView } from "@/lib/rewards/my-vouchers";
import { useRedemptionHistory } from "../hooks/use-redemption-history";

const ICON_TONE = { green: "bg-tone-green-bg text-tone-green-fg", danger: "bg-danger-soft text-danger", blue: "bg-tone-blue-bg text-tone-blue-fg" };
const STATUS_TEXT = { green: "text-tone-green-fg", danger: "text-danger", blue: "text-tone-blue-fg" };
const POINTS_TEXT = { default: "text-ink", muted: "text-ink-muted", blue: "text-tone-blue-fg" };

function MobileRow({ view }: { view: HistoryRowView }) {
  return (
    <li className="flex items-start gap-3 p-4">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-[12px] ${ICON_TONE[view.iconTone]}`}><Icon name={view.icon} size={20} /></span>
      <div className="min-w-0 flex-1"><p className="line-clamp-2 font-bold text-ink">{view.title}</p><p className="mt-0.5 text-caption text-ink-muted">{view.subline}</p></div>
      <div className="shrink-0 text-right"><p className={`font-extrabold ${POINTS_TEXT[view.pointsTone]}`}>{view.points}</p><p className={`text-caption font-bold ${STATUS_TEXT[view.statusTone]}`}>{view.status}</p></div>
    </li>
  );
}

function DesktopTable({ items }: { items: Array<{ id: string; reference: string; view: HistoryRowView }> }) {
  return (
    <table className="mt-4 w-full text-left text-body-sm">
      <thead className="text-caption text-ink-muted"><tr>
        <th scope="col" className="py-2 pr-3 font-medium">Thời gian</th><th scope="col" className="py-2 pr-3 font-medium">Voucher</th><th scope="col" className="py-2 pr-3 font-medium">Mã giao dịch</th>
        <th scope="col" className="py-2 pr-3 text-right font-medium">Điểm</th><th scope="col" className="py-2 font-medium">Trạng thái</th>
      </tr></thead>
      <tbody>{items.map(({ id, reference, view }) => (
        <tr key={id} className="border-t border-line-subtle">
          <td className="whitespace-nowrap py-4 pr-3 text-ink-muted">{view.when}</td><td className="py-4 pr-3 font-bold text-ink">{view.desktopTitle}</td><td className="whitespace-nowrap py-4 pr-3 text-ink-muted">{reference}</td>
          <td className={`py-4 pr-3 text-right text-body font-extrabold ${POINTS_TEXT[view.pointsTone]}`}>{view.points}</td>
          <td className="whitespace-nowrap py-4"><Tag tone={view.statusTone}>{view.desktopStatus}</Tag></td>
        </tr>
      ))}</tbody>
    </table>
  );
}

/** Both layouts in one component (Figma 129:243 mobile list, 130:334 desktop table); CSS picks one. */
export function RedemptionHistory({ heading: Heading = "h2" }: { heading?: "h1" | "h2" }) {
  const { history, loading, error, reload, loadMore, loadingMore, loadMoreFailed } = useRedemptionHistory();
  const summary = history ? monthSummaryLine(history.monthSummary) : null;
  const rows = (history?.items ?? []).map((entry) => ({ id: entry.id, reference: entry.reference, view: historyRowView(entry) }));
  return (
    <section aria-label="Lịch sử đổi điểm" aria-busy={loading} className="lg:rounded-[20px] lg:border lg:border-line lg:bg-surface lg:p-6">
      <div className="hidden items-baseline justify-between gap-4 lg:flex">
        <Heading className="text-title-sm font-extrabold text-ink">Lịch sử đổi điểm</Heading>
        {summary?.short && <p className="text-body-sm font-bold text-tone-amber-fg">{summary.short}</p>}
      </div>
      {summary && <div className="rounded-[16px] bg-tone-amber-tint p-4 lg:hidden"><p className="text-caption font-medium text-tone-amber-fg">{summary.month}</p><p className="font-extrabold text-ink">{summary.line}</p></div>}

      {!history && !error && <div className="mt-4 space-y-3" role="status" aria-label="Đang tải lịch sử">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="thought-skeleton h-[72px] rounded-[16px]" />)}</div>}
      {!history && error && <div className="py-8 text-center"><p role="alert" className="text-body-sm text-ink-muted">Chưa tải được lịch sử.</p><Button variant="secondary" size="md" className="mt-3" onClick={reload}>Thử lại</Button></div>}

      {history && rows.length === 0 && <p className="py-8 text-center text-body-sm text-ink-muted">Chưa có giao dịch đổi quà nào.</p>}
      {history && rows.length > 0 && <>
        <ul className="mt-4 divide-y divide-line rounded-[20px] border border-line bg-surface lg:hidden">{rows.map(({ id, view }) => <MobileRow key={id} view={view} />)}</ul>
        <div className="hidden lg:block"><DesktopTable items={rows} /></div>
        {history.hasMore && <div className="mt-4 flex flex-col items-center gap-2">
          {loadMoreFailed && <p role="alert" className="text-caption text-danger">Chưa tải thêm được. Thử lại nhé.</p>}
          <Button variant="secondary" size="md" onClick={loadMore} loading={loadingMore}>Xem thêm</Button>
        </div>}
      </>}
      <p className="mt-4 px-1 text-caption text-ink-muted lg:hidden">Lịch sử không sửa hay xoá được. Giao dịch đổi quà cũng hiện ở Ví điểm, mục Chi. Hoàn điểm là một giao dịch riêng, không xoá giao dịch gốc.</p>
      <p className="mt-4 hidden text-caption text-ink-muted lg:block">Lịch sử không sửa hay xoá được. Hoàn điểm là một giao dịch riêng (RFD-…) trỏ về giao dịch gốc.</p>
    </section>
  );
}
