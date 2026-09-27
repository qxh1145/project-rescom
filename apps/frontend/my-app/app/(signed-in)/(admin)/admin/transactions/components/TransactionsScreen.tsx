"use client";

import { AdminPage } from "@/components/layout/admin/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Select } from "@/components/ui/Select";
import {
  TRANSACTION_FILTERS,
  TRANSACTION_PERIODS,
  isTransactionPeriod,
} from "@/lib/admin/admin-transactions";
import {
  TRANSACTIONS_LOAD_MORE_FAILED,
  summaryLoadErrorMessage,
  transactionsLoadErrorMessage,
} from "@/lib/admin/transactions-messages";
import { useAdminTransactions } from "../hooks/use-admin-transactions";
import { JournalTable } from "./JournalTable";
import { LedgerSummaryCards } from "./LedgerSummaryCards";

/**
 * Figma 11f "Giao dịch điểm" (63:1629): four summary cards, then the ledger
 * journals with "Loại giao dịch" segments and a period select. Read-only
 * ("Sổ ghi kép · không sửa, không xoá"). ASSUMED below lg: cards 2 per row,
 * the table scrolls horizontally.
 */
export function TransactionsScreen() {
  const view = useAdminTransactions();

  return (
    <AdminPage title="Giao dịch điểm" meta="Sổ ghi kép · không sửa, không xoá">
      <div className="flex flex-col gap-5">
        {view.summaryError ? (
          <Alert tone="danger">
            {summaryLoadErrorMessage(view.summaryError)}{" "}
            <button type="button" className="font-bold underline" onClick={view.reloadSummary}>
              Thử lại
            </button>
          </Alert>
        ) : null}
        <LedgerSummaryCards summary={view.summary} />

        <section
          aria-label="Sổ giao dịch"
          aria-busy={view.loading || view.refreshing || undefined}
          className="rounded-[22px] border border-line bg-surface px-6 pt-5 pb-5.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SegmentedControl
              label="Loại giao dịch"
              segments={TRANSACTION_FILTERS}
              value={view.filter}
              onChange={view.setFilter}
              variant="bordered"
            />
            <Select
              id="transactions-period"
              aria-label="Khoảng thời gian"
              options={TRANSACTION_PERIODS}
              value={view.period}
              onChange={(event) => {
                if (isTransactionPeriod(event.target.value)) view.setPeriod(event.target.value);
              }}
              height={44}
              className="w-26.75"
            />
          </div>
          {view.error ? (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
              <Alert tone="danger" className="flex-1">
                {transactionsLoadErrorMessage(view.error)}
              </Alert>
              <Button variant="secondary" size="base" radius="field" onClick={view.reload}>
                Thử lại
              </Button>
            </div>
          ) : null}
          <div className="mt-3">
            <JournalTable
              rows={view.rows}
              loading={view.loading}
              emptyText={view.error ? "Chưa tải được giao dịch." : "Không có giao dịch nào trong khoảng thời gian này."}
            />
          </div>
          {view.hasMore ? (
            // ASSUMED (not drawn): 50 journals per page.
            <div className="mt-4 flex flex-col items-center gap-3">
              {view.loadMoreFailed ? (
                <Alert tone="danger" className="w-full">
                  {TRANSACTIONS_LOAD_MORE_FAILED}
                </Alert>
              ) : null}
              <Button variant="secondary" size="sm" onClick={() => void view.loadMore()} loading={view.loadingMore}>
                Tải thêm
              </Button>
            </div>
          ) : null}
        </section>
      </div>
    </AdminPage>
  );
}
