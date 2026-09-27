"use client";

import { MobileTitleBar } from "@/components/layout/app/MobileTopBar";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { walletLoadErrorMessage } from "@/lib/wallet/wallet-messages";
import { useWallet } from "../hooks/use-wallet";
import { BalanceCard } from "./BalanceCard";
import { BucketCards } from "./BucketCards";
import { TopUpCard } from "./TopUpCard";
import { TransactionHistory } from "./TransactionHistory";

/**
 * Figma 7 "Ví điểm" — desktop 62:225 (440px column + history card), mobile
 * 62:1052 (title bar with bell, stacked cards, list).
 */
export function WalletScreen() {
  const {
    wallet,
    error,
    loading,
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
          <p className="flex items-center gap-3 py-16 text-body text-ink-muted" role="status" aria-busy={loading}>
            <Spinner className="size-5 text-primary" />
            Đang tải Ví điểm…
          </p>
        ) : (
          <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[440px_minmax(0,1fr)] lg:items-start lg:gap-7">
            <div className="flex flex-col gap-4">
              <BalanceCard available={wallet.balance.available} />
              <BucketCards balance={wallet.balance} pendingHoursLeft={pendingHoursLeft} pendingDue={pendingDue} />
              <TopUpCard />
            </div>
            <TransactionHistory
              rows={rows}
              filter={filter}
              onFilterChange={setFilter}
              hasMore={hasMore}
              onLoadMore={loadMore}
              loadingMore={loadingMore}
              loadMoreFailed={loadMoreFailed}
            />
          </div>
        )}
      </div>
    </>
  );
}
