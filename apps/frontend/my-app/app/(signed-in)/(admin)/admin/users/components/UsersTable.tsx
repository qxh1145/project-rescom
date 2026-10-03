"use client";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { usersLoadErrorMessage } from "@/lib/admin/users-messages";
import type { AdminUserPage } from "@/lib/admin/users-service";
import { formatCount, formatDayMonth, fraudCellOf, userStatusView, userTitleOf } from "@/lib/admin/users-view";
import { StatusPill } from "./StatusPill";

interface UsersTableProps {
  data: AdminUserPage | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  page: number;
  onPage: (page: number) => void;
}

const HEAD = "h-10.5 border-b border-line px-2 text-left align-middle text-caption font-semibold text-ink-muted";
const CELL = "h-15 px-2 align-middle";

/** Figma 11d "Section" (63:2276): 645px card, 60px rows, selected row tinted green. */
export function UsersTable({ data, loading, error, onRetry, selectedId, onSelect, page, onPage }: UsersTableProps) {
  const items = data?.items ?? [];
  const totalPages = data?.pagination.totalPages ?? 0;

  return (
    <section aria-label="Danh sách người dùng" className="min-w-0 rounded-[22px] border border-line bg-surface px-6 pt-3 pb-3.5">
      {error ? (
        <Alert tone="danger" className="my-3 items-center">
          <span className="flex flex-wrap items-center gap-3">
            {usersLoadErrorMessage(error)}
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Thử lại
            </Button>
          </span>
        </Alert>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] table-fixed border-collapse" aria-busy={loading || undefined}>
          <thead>
            <tr>
              <th scope="col" className={`${HEAD} w-[26.2%]`}>
                Người dùng
              </th>
              <th scope="col" className={`${HEAD} w-[22.1%]`}>
                Trạng thái
              </th>
              <th scope="col" className={`${HEAD} w-[14.2%]`}>
                Khả dụng
              </th>
              <th scope="col" className={`${HEAD} w-[23.7%]`}>
                FraudLog 14 ngày
              </th>
              <th scope="col" className={`${HEAD} w-[13.8%]`}>
                Tham gia
              </th>
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0
              ? Array.from({ length: 5 }, (_, index) => (
                  <tr key={index} className="border-t border-line-subtle first:border-t-0">
                    <td colSpan={5} className={CELL}>
                      <span className="block h-4 w-2/3 animate-pulse rounded bg-surface-subtle" />
                    </td>
                  </tr>
                ))
              : null}
            {!loading && !error && items.length === 0 ? (
              <tr>
                {/* ASSUMED (design): empty state not drawn. */}
                <td colSpan={5} className="px-2 py-10 text-center text-body-sm text-ink-muted">
                  Không có người dùng nào khớp bộ lọc.
                </td>
              </tr>
            ) : null}
            {items.map((user) => {
              const selected = user.id === selectedId;
              const status = userStatusView(user);
              const fraud = fraudCellOf(user);
              return (
                <tr
                  key={user.id}
                  onClick={() => onSelect(user.id)}
                  className={`cursor-pointer border-t border-line-subtle first:border-t-0 ${
                    selected ? "bg-tone-green-bg" : "hover:bg-surface-muted"
                  }`}
                >
                  <th scope="row" className={`${CELL} text-left font-normal`}>
                    <button
                      type="button"
                      aria-current={selected ? "true" : undefined}
                      aria-controls="admin-user-detail"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(user.id);
                      }}
                      className="flex w-full min-w-0 flex-col items-start rounded-md text-left"
                    >
                      <span className="w-full truncate text-label font-bold text-ink">{userTitleOf(user)}</span>
                      <span className="mt-0.5 w-full truncate text-[12px] text-ink-muted">{user.email}</span>
                    </button>
                  </th>
                  <td className={CELL}>
                    <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  </td>
                  <td className={`${CELL} text-label font-bold text-ink`}>{formatCount(user.balance?.available)}</td>
                  <td className={CELL}>
                    {fraud.flagged ? (
                      <StatusPill tone="danger">{fraud.text}</StatusPill>
                    ) : (
                      <span className="text-body-sm text-ink-muted">{fraud.text}</span>
                    )}
                  </td>
                  <td className={`${CELL} text-body-sm text-ink-muted`}>{formatDayMonth(user.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 ? (
        // ASSUMED (design): pager not drawn (Figma shows one page).
        <nav aria-label="Phân trang người dùng" className="mt-3 flex items-center justify-end gap-3 border-t border-line-subtle pt-3">
          <span className="text-body-sm text-ink-muted">
            Trang {page}/{totalPages}
          </span>
          <Button variant="secondary" size="sm" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>
            Trước
          </Button>
          <Button variant="secondary" size="sm" disabled={page >= totalPages || loading} onClick={() => onPage(page + 1)}>
            Sau
          </Button>
        </nav>
      ) : null}
    </section>
  );
}
