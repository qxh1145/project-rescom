"use client";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Tag } from "@/components/ui/Tag";
import { formatShortDateTime } from "@/lib/format/date-time";
import { TOP_UP_MIN_POINTS, formatVnd, topUpVnd } from "@/lib/wallet/top-up";
import {
  filterHistory,
  formatRowPoints,
  rowPresentation,
  statusLabel,
  type BucketPresentation,
  type HistoryFilter,
  type HistoryRow,
} from "@/lib/wallet/wallet-history";
import { WALLET_LOAD_MORE_FAILED } from "@/lib/wallet/wallet-messages";

const DESKTOP_FILTERS = [
  { value: "all", label: "Tất cả" },
  { value: "in", label: "Nhận" },
  { value: "out", label: "Chi" },
  { value: "top-up", label: "Nạp" },
] as const satisfies ReadonlyArray<{ value: HistoryFilter; label: string }>;

/** Mobile 62:1105 has no "Nạp" segment. */
const MOBILE_FILTERS = DESKTOP_FILTERS.slice(0, 3);

/** "Nạp" chosen on desktop reads as "Tất cả" on the mobile control, which has no such segment. */
function mobileFilterOf(filter: HistoryFilter): Exclude<HistoryFilter, "top-up"> {
  return filter === "top-up" ? "all" : filter;
}

/** Amount / label color per pill tone; spending (−) stays ink (ASSUMED, not drawn). */
const TONE_TEXT: Record<BucketPresentation["tone"], string> = {
  amber: "text-tone-amber-fg",
  teal: "text-tone-teal-fg",
  green: "text-primary",
  neutral: "text-ink-strong",
};

const TONE_TILE: Record<BucketPresentation["tone"], string> = {
  amber: "bg-tone-amber-bg text-tone-amber-fg",
  teal: "bg-tone-teal-bg text-tone-teal-fg",
  green: "bg-tone-green-bg text-tone-green-fg",
  neutral: "bg-surface-subtle text-ink-strong",
};

function amountClass(row: HistoryRow): string {
  return row.direction === "out" ? "text-ink" : TONE_TEXT[rowPresentation(row).tone];
}

/** Mobile row icon (Figma 62:1113 hourglass, 62:1121 check, 62:1129 unlock, 62:1137 lock). */
function iconOf(row: HistoryRow): IconName {
  if (row.kind === "STARTER_UNLOCK") return "unlock";
  if (row.kind === "TOP_UP") return "plus";
  if (row.direction === "out") return "arrows-swap"; // ASSUMED
  if (row.bucket === "PENDING" || row.bucket === "INTEGRITY_HOLD") return "hourglass";
  if (row.bucket === "FROZEN") return "lock";
  return "check";
}

function emptyText(filter: HistoryFilter, hasHistory: boolean): string {
  if (!hasHistory) return "Chưa có giao dịch nào. Làm khảo sát để nhận điểm đầu tiên.";
  return filter === "top-up" ? "Chưa có lần nạp điểm nào." : "Không có giao dịch nào khớp bộ lọc.";
}

interface TransactionHistoryProps {
  /** Every loaded row; each layout applies its own filter. */
  rows: HistoryRow[];
  filter: HistoryFilter;
  onFilterChange: (filter: HistoryFilter) => void;
  /** Older entries exist ("Tải thêm", ASSUMED: not drawn). */
  hasMore: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
  loadMoreFailed: boolean;
}

function LoadMore({ hasMore, onLoadMore, loadingMore, loadMoreFailed }: Omit<TransactionHistoryProps, "rows" | "filter" | "onFilterChange">) {
  if (!hasMore) return null;
  return (
    <div className="mt-4 flex flex-col items-center gap-3">
      {loadMoreFailed ? (
        <Alert tone="danger" className="w-full">
          {WALLET_LOAD_MORE_FAILED}
        </Alert>
      ) : null}
      <Button variant="secondary" size="sm" onClick={onLoadMore} loading={loadingMore}>
        Tải thêm
      </Button>
    </div>
  );
}

/**
 * Figma 7 "Lịch sử giao dịch" — desktop table in a card (62:301), mobile
 * list (62:1110). Empty states and "Tải thêm" are not drawn (ASSUMED).
 */
export function TransactionHistory({ rows: allRows, filter, onFilterChange, ...more }: TransactionHistoryProps) {
  const hasHistory = allRows.length > 0 || more.hasMore;
  const rows = filterHistory(allRows, filter);
  const mobileFilter = mobileFilterOf(filter);
  const mobileRows = filterHistory(allRows, mobileFilter);
  const empty = rows.length === 0;
  return (
    <>
      {/* Desktop */}
      <section
        aria-labelledby="wallet-history-title-desktop"
        className="hidden min-h-[903px] flex-col rounded-card border border-line bg-surface px-7 pt-6 pb-7 lg:flex"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id="wallet-history-title-desktop" className="text-[22px] font-extrabold text-ink">
            Lịch sử giao dịch
          </h2>
          <SegmentedControl
            label="Lọc giao dịch"
            segments={DESKTOP_FILTERS}
            value={filter}
            onChange={onFilterChange}
            variant="bordered"
          />
        </div>
        <table className="mt-4 w-full table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[96px]" />
            <col className="w-[174px]" />
            <col />
            <col className="w-[165px]" />
            <col className="w-[64px]" />
          </colgroup>
          <thead>
            <tr className="text-caption font-semibold text-ink-muted">
              <th scope="col" className="h-9 border-b border-line font-semibold">Thời gian</th>
              <th scope="col" className="h-9 border-b border-line font-semibold">Loại</th>
              <th scope="col" className="h-9 border-b border-line font-semibold">Khảo sát / ghi chú</th>
              <th scope="col" className="h-9 border-b border-line font-semibold">Trạng thái</th>
              <th scope="col" className="h-9 border-b border-line text-right font-semibold">Điểm</th>
            </tr>
          </thead>
          <tbody className="text-label">
            {empty ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-body-sm text-ink-muted">
                  {emptyText(filter, hasHistory)}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const pill = rowPresentation(row);
                return (
                  <tr key={row.id} className="[&:last-child>td]:border-b-0">
                    <td className="h-[59px] border-b border-line-subtle font-normal whitespace-nowrap text-ink-muted">
                      {formatShortDateTime(row.createdAt)}
                    </td>
                    <td className="h-[59px] truncate border-b border-line-subtle pr-3 font-bold text-ink">{row.title}</td>
                    <td className="h-[59px] truncate border-b border-line-subtle pr-3 font-normal text-ink" title={row.note}>
                      {row.note}
                    </td>
                    <td className="h-[59px] border-b border-line-subtle">
                      <Tag tone={pill.tone}>{statusLabel(row)}</Tag>
                    </td>
                    <td className={`h-[59px] border-b border-line-subtle text-right font-extrabold ${amountClass(row)}`}>
                      {formatRowPoints(row)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <LoadMore {...more} />
        <p className="mt-4 text-caption text-ink-muted">Lịch sử giao dịch không thể sửa hay xoá.</p>
      </section>

      {/* Mobile */}
      <section aria-labelledby="wallet-history-title-mobile" className="flex flex-col lg:hidden">
        <h2 id="wallet-history-title-mobile" className="text-[17px] font-extrabold text-ink">
          Lịch sử giao dịch
        </h2>
        <SegmentedControl
          label="Lọc giao dịch"
          segments={MOBILE_FILTERS}
          value={mobileFilter}
          onChange={onFilterChange}
          fullWidth
          variant="bordered"
          className="mt-3"
        />
        {mobileRows.length === 0 ? (
          <p className="mt-3 rounded-[18px] border border-line bg-surface px-4 py-6 text-center text-body-sm text-ink-muted">
            {emptyText(mobileFilter, hasHistory)}
          </p>
        ) : (
          <ul className="mt-3 overflow-hidden rounded-[18px] border border-line bg-surface">
            {mobileRows.map((row) => {
              const pill = rowPresentation(row);
              return (
                <li key={row.id} className="flex items-center gap-3 border-b border-line-subtle px-4 py-3.5 last:border-b-0">
                  <span
                    aria-hidden
                    className={`inline-flex size-10 shrink-0 items-center justify-center rounded-field ${TONE_TILE[pill.tone]}`}
                  >
                    <Icon name={iconOf(row)} size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-label font-bold text-ink">{row.title}</p>
                    <p className="mt-0.5 truncate text-[12px] text-ink-muted">
                      {row.shortNote ? `${row.shortNote} · ` : ""}
                      {formatShortDateTime(row.createdAt)}
                    </p>
                  </div>
                  <div className={`flex shrink-0 flex-col items-end ${amountClass(row)}`}>
                    <span className="text-body font-extrabold">{formatRowPoints(row)}</span>
                    <span className="text-[11px] font-bold whitespace-nowrap">{pill.label}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <LoadMore {...more} />
        <p className="mt-3 text-[12px] leading-[18px] text-ink-muted">
          Lịch sử không thể sửa hay xoá. Nạp tối thiểu {TOP_UP_MIN_POINTS} điểm ({formatVnd(topUpVnd(TOP_UP_MIN_POINTS))});
          điểm không quy đổi ngược ra tiền.
        </p>
      </section>
    </>
  );
}
