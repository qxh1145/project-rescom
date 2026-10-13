import Link from "next/link";
import type { FraudLogEntry } from "@/lib/admin/fraud-log-service";
import { fraudDetailText, fraudKindOf, fraudTypeLabel } from "@/lib/admin/fraud-log-view";
import { formatDayMonthTime, shortCodeOf } from "@/lib/admin/users-view";

const HEAD = "h-10.5 border-b border-line text-left align-middle text-caption font-semibold text-ink-muted";
const CELL = "h-16.25 pr-3 align-middle";

interface FraudLogTableProps {
  items: FraudLogEntry[];
  loading: boolean;
}

/** Figma 11e "Section" (62:2269): 1095px card, 65px rows. Read only. */
export function FraudLogTable({ items, loading }: FraudLogTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] table-fixed border-collapse" aria-busy={loading || undefined}>
        <caption className="sr-only">Nhật ký vi phạm (chỉ đọc)</caption>
        <thead>
          <tr>
            <th scope="col" className={`${HEAD} w-[11.3%]`}>
              Thời gian
            </th>
            <th scope="col" className={`${HEAD} w-[9.9%]`}>
              Người dùng
            </th>
            <th scope="col" className={`${HEAD} w-[23%]`}>
              Loại
            </th>
            <th scope="col" className={`${HEAD} w-[25.5%]`}>
              Khảo sát
            </th>
            <th scope="col" className={`${HEAD} w-[30.3%]`}>
              Chi tiết
            </th>
          </tr>
        </thead>
        <tbody>
          {loading && items.length === 0
            ? Array.from({ length: 5 }, (_, index) => (
                <tr key={index} className="border-t border-line-subtle first:border-t-0">
                  <td colSpan={5} className={CELL}>
                    <span className="block h-4 w-3/4 animate-pulse rounded bg-surface-subtle" />
                  </td>
                </tr>
              ))
            : null}
          {!loading && items.length === 0 ? (
            <tr>
              {/* ASSUMED (design): empty state not drawn. */}
              <td colSpan={5} className="py-10 text-center text-body-sm text-ink-muted">
                Không có mục FraudLog nào khớp bộ lọc.
              </td>
            </tr>
          ) : null}
          {items.map((entry) => {
            const kind = fraudKindOf(entry);
            return (
              <tr key={entry.id} className="border-t border-line-subtle first:border-t-0">
                <td className={`${CELL} text-body-sm text-ink-muted`}>
                  <time dateTime={entry.createdAt}>{formatDayMonthTime(entry.createdAt)}</time>
                </td>
                <th scope="row" className={`${CELL} text-left`}>
                  <Link
                    href={`/admin/users?id=${encodeURIComponent(entry.userId)}`}
                    className="text-label font-bold text-ink hover:underline"
                  >
                    {shortCodeOf(entry.userId)}
                  </Link>
                </th>
                <td className={CELL}>
                  <span className="block text-label font-bold text-ink">{fraudTypeLabel(kind)}</span>
                  <span className="block text-[12px] text-ink-muted">{kind}</span>
                </td>
                <td className={`${CELL} text-body-sm text-ink`}>
                  <span className="block truncate" title={entry.survey?.title}>
                    {entry.survey?.title ?? "Chưa có"}
                  </span>
                </td>
                <td className={`${CELL} text-body-sm text-ink-strong`}>
                  <span className="block truncate">{fraudDetailText(entry)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
