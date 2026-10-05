"use client";

import type { TopUpStatus } from "@rescom/schemas";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Spinner } from "@/components/ui/Spinner";
import { formatTransferReference, requesterName, topUpStatusTabs } from "@/lib/admin/top-up-admin";
import type { AdminTopUp } from "@/lib/admin/top-up-admin-service";
import { formatShortDateTime } from "@/lib/format/date-time";
import { formatPoints, formatVnd } from "@/lib/wallet/top-up";

const EMPTY_TEXT: Record<TopUpStatus, string> = {
  PENDING: "Không có yêu cầu nào chờ duyệt.",
  APPROVED: "Chưa có yêu cầu nào được duyệt.",
  REJECTED: "Chưa có yêu cầu nào bị từ chối.",
};

/** Reviewed tabs show when the decision was made (ASSUMED (design); Figma draws the pending tab only). */
const TIME_HEADER: Record<TopUpStatus, string> = {
  PENDING: "Gửi lúc",
  APPROVED: "Duyệt lúc",
  REJECTED: "Từ chối lúc",
};

interface TopUpQueueTableProps {
  status: TopUpStatus;
  onStatusChange: (status: TopUpStatus) => void;
  pendingCount: number | undefined;
  items: AdminTopUp[];
  total: number;
  /** First load of this tab. */
  loading: boolean;
  /** The list could not be loaded (the error is shown above the table). */
  failed: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Figma 63:425: "Lọc yêu cầu" segments + requests table (605px card, 22px
 * radius). The selected row is tinted green; a row click or its name button
 * opens it in the "Đối chiếu yêu cầu" panel.
 */
export function TopUpQueueTable({
  status,
  onStatusChange,
  pendingCount,
  items,
  total,
  loading,
  failed,
  selectedId,
  onSelect,
}: TopUpQueueTableProps) {
  return (
    <section aria-label="Yêu cầu nạp điểm" className="rounded-[22px] border border-line bg-surface px-6 pt-5 pb-5.5">
      <SegmentedControl
        label="Lọc yêu cầu"
        segments={topUpStatusTabs(pendingCount)}
        value={status}
        onChange={onStatusChange}
        variant="bordered"
      />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-138.75 table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[20.7%]" />
            <col className="w-[16.8%]" />
            <col className="w-[14.5%]" />
            <col className="w-[27%]" />
            <col />
          </colgroup>
          <thead>
            <tr className="text-caption text-ink-muted">
              <th scope="col" className="h-9 border-b border-line font-semibold">Người dùng</th>
              <th scope="col" className="h-9 border-b border-line font-semibold">Gói</th>
              <th scope="col" className="h-9 border-b border-line font-semibold">Số tiền</th>
              <th scope="col" className="h-9 border-b border-line font-semibold">Nội dung CK</th>
              <th scope="col" className="h-9 border-b border-line font-semibold">{TIME_HEADER[status]}</th>
            </tr>
          </thead>
          <tbody className="text-body-sm text-ink">
            {loading ? (
              <tr>
                <td colSpan={5} className="py-8 text-ink-muted">
                  <span role="status" className="flex items-center justify-center gap-2.5">
                    <Spinner className="size-4 text-primary" />
                    Đang tải yêu cầu…
                  </span>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-ink-muted">
                  {failed ? "Chưa tải được danh sách." : EMPTY_TEXT[status]}
                </td>
              </tr>
            ) : (
              items.map((item) => {
                const selected = item.id === selectedId;
                const name = requesterName(item);
                return (
                  <tr
                    key={item.id}
                    onClick={() => onSelect(item.id)}
                    className={[
                      "cursor-pointer [&+tr>td]:border-t [&+tr>td]:border-line-subtle",
                      selected ? "bg-tone-green-bg" : "hover:bg-surface-muted",
                    ].join(" ")}
                  >
                    <td className="h-11.75 truncate pr-2 pl-2">
                      <button
                        type="button"
                        aria-pressed={selected}
                        aria-label={`${name}, ${formatPoints(item.amount)} điểm`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect(item.id);
                        }}
                        className="max-w-full truncate rounded-sm text-left font-bold"
                      >
                        {name}
                      </button>
                    </td>
                    <td className="truncate font-bold">{formatPoints(item.amount)} điểm</td>
                    <td className="truncate">{formatVnd(item.amountVnd)}</td>
                    <td className="truncate font-mono" title={item.transferReference}>
                      {formatTransferReference(item.transferReference)}
                    </td>
                    <td className="truncate text-ink-muted">
                      {formatShortDateTime(status === "PENDING" ? item.createdAt : (item.reviewedAt ?? item.createdAt))}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {total > items.length ? (
        // ASSUMED (not drawn): the backend pages by 50; older requests show after these are handled.
        <p className="mt-3 text-caption text-ink-muted">
          Đang hiển thị {items.length}/{total} yêu cầu{status === "PENDING" ? " cũ nhất" : " mới nhất"}.
        </p>
      ) : null}
    </section>
  );
}
