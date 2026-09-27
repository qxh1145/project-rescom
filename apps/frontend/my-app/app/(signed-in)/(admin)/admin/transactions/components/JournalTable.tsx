import { Spinner } from "@/components/ui/Spinner";
import type { AdminTransactionRow, TransactionTone } from "@/lib/admin/admin-transactions";
import { formatShortDateTime } from "@/lib/format/date-time";
import { formatPoints } from "@/lib/wallet/top-up";

const AMOUNT_TONES: Record<TransactionTone, string> = {
  teal: "text-tone-teal-fg",
  amber: "text-tone-amber-fg",
  ink: "text-ink",
};

interface JournalTableProps {
  rows: AdminTransactionRow[];
  loading: boolean;
  /** Text shown when there is no row (empty filter or failed load). */
  emptyText: string;
}

/** Figma 63:1713–63:1767: Thời gian · Loại · Từ → Đến · Liên quan · Điểm (47px rows). */
export function JournalTable({ rows, loading, emptyText }: JournalTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-225 table-fixed border-collapse text-left">
        <colgroup>
          <col className="w-[12.5%]" />
          <col className="w-[22.5%]" />
          <col className="w-[29.8%]" />
          <col />
          <col className="w-[6%]" />
        </colgroup>
        <thead>
          <tr className="text-caption text-ink-muted">
            <th scope="col" className="h-9 border-b border-line font-semibold">Thời gian</th>
            <th scope="col" className="h-9 border-b border-line font-semibold">Loại</th>
            <th scope="col" className="h-9 border-b border-line font-semibold">Từ → Đến</th>
            <th scope="col" className="h-9 border-b border-line font-semibold">Liên quan</th>
            <th scope="col" className="h-9 border-b border-line text-right font-semibold">Điểm</th>
          </tr>
        </thead>
        <tbody className="text-body-sm text-ink">
          {loading ? (
            <tr>
              <td colSpan={5} className="py-8 text-ink-muted">
                <span role="status" className="flex items-center justify-center gap-2.5">
                  <Spinner className="size-4 text-primary" />
                  Đang tải giao dịch…
                </span>
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-8 text-center text-ink-muted">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="[&+tr>td]:border-t [&+tr>td]:border-line-subtle">
                <td className="h-11.75 truncate pr-3 text-ink-muted">{formatShortDateTime(row.createdAt)}</td>
                <td className="truncate pr-3 font-bold" title={row.title}>
                  {row.title}
                </td>
                <td className="truncate pr-3" title={row.route}>
                  {row.route}
                </td>
                <td className="truncate pr-3" title={row.related}>
                  {row.related}
                </td>
                <td className={`text-right font-extrabold ${AMOUNT_TONES[row.tone]}`}>{formatPoints(row.amount)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
