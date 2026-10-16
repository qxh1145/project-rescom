"use client";

import Link from "next/link";
import { MobileTitleBar } from "@/components/layout/app/MobileTopBar";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { REWARDS_ENABLED } from "@/lib/pilot-scope";
import { walletLoadErrorMessage } from "@/lib/wallet/wallet-messages";
import { useWallet } from "../hooks/use-wallet";
import { useTopUpHistory } from "@/lib/wallet/use-top-up-history";
import { useWalletTopUpMode } from "@/lib/wallet/use-wallet-top-up-mode";
import { usePayosPolling } from "@/lib/wallet/use-payos-polling";
import { useSession } from "@/lib/session/SessionProvider";
import { BalanceCard } from "./BalanceCard";
import { BalanceGrid, BalanceGridSkeleton } from "./BalanceGrid";
import { TopUpCard } from "./TopUpCard";
import { PayosTopUpCompactCard } from "./PayosTopUpCompactCard";
import { TransactionHistory } from "./TransactionHistory";
import { ProcessingBanner } from "./ProcessingBanner";
import { TopUpHistory } from "./TopUpHistory";

export function WalletScreen() {
  const {
    wallet,
    error,
    reload,
    filter,
    setFilter,
    rows,
    hasMore,
    loadMore,
    loadingMore,
    loadMoreFailed,
    pendingHoursLeft,
    pendingDue,
  } = useWallet();

  const { mode: topUpMode, reload: reloadTopUpMode } = useWalletTopUpMode();
  const historyState = useTopUpHistory(topUpMode);
  const { refresh: refreshSession } = useSession();

  // If a processing top-up exists, poll it
  const processingId = historyState.processingTopUp?.id ?? null;
  usePayosPolling(processingId, null, () => {
    // Terminal callback: reload wallet details, history and session balance chip
    reload();
    historyState.reload();
    refreshSession();
  });

  return (
    <>
      <MobileTitleBar title="Ví điểm" />
      <h1 className="sr-only max-lg:hidden">Ví điểm</h1>
      <div className="mx-auto w-full max-w-[1440px] px-5 pt-4 pb-8 lg:px-12 lg:pt-8 lg:pb-12">
        {error && !wallet ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <Alert tone="danger" className="flex-1">
              {walletLoadErrorMessage(error)}
            </Alert>
            <Button variant="secondary" size="base" radius="field" onClick={reload}>
              Thử lại
            </Button>
          </div>
        ) : !wallet ? (
          <BalanceGridSkeleton />
        ) : (
          <div className="flex flex-col gap-4">
            {historyState.processingTopUp && (
              <ProcessingBanner topUp={historyState.processingTopUp} />
            )}

            <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[440px_minmax(0,1fr)] lg:items-start lg:gap-7">
              <div className="flex flex-col gap-4">
                <BalanceCard available={wallet.balance.available} />
                {REWARDS_ENABLED && (
                  <Link
                    href="/rewards"
                    className="flex items-center justify-between rounded-[20px] border border-line bg-surface p-4 shadow-xs hover:border-primary/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-tone-amber-bg text-tone-amber-accent">
                        <Icon name="gift" size={20} />
                      </span>
                      <div className="flex flex-col">
                        <span className="text-body font-bold text-ink">Đổi quà</span>
                        <span className="text-caption text-ink-muted">Dùng điểm đổi voucher F&B</span>
                      </div>
                    </div>
                    <Icon name="chevron-right" size={18} className="text-ink-muted" />
                  </Link>
                )}
                <BalanceGrid
                  balance={wallet.balance}
                  pendingHoursLeft={pendingHoursLeft}
                  pendingDue={pendingDue}
                />
                {topUpMode === "loading" ? (
                  <div
                    role="status"
                    aria-label="Đang tải phương thức nạp..."
                    className="h-[120px] animate-pulse rounded-card border border-line bg-surface shadow-xs"
                  />
                ) : topUpMode === "error" ? (
                  <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-xs">
                    <Alert tone="danger">
                      Không thể kiểm tra phương thức nạp điểm lúc này. Vui lòng thử lại.
                    </Alert>
                    <Button variant="secondary" size="base" radius="field" onClick={reloadTopUpMode}>
                      Thử lại
                    </Button>
                  </div>
                ) : topUpMode === "manual" ? (
                  <TopUpCard />
                ) : (
                  <PayosTopUpCompactCard />
                )}
              </div>

              <div className="flex flex-col gap-4">
                <TransactionHistory
                  rows={rows}
                  filter={filter}
                  onFilterChange={setFilter}
                  hasMore={hasMore}
                  onLoadMore={loadMore}
                  loadingMore={loadingMore}
                  loadMoreFailed={loadMoreFailed}
                />
                <TopUpHistory
                  items={historyState.items}
                  loading={historyState.loading}
                  error={historyState.error}
                  partialError={historyState.partialError}
                  onRetry={historyState.reload}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
