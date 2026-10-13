"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { VOUCHER_CATEGORIES, VOUCHER_SORTS, type VoucherCategory, type VoucherSort } from "@rescom/schemas";
import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Select } from "@/components/ui/Select";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { Button } from "@/components/ui/Button";
import { useApiQuery } from "@/lib/api/use-api-query";
import {
  activeFilterCount,
  type RewardsFilters,
} from "@/lib/rewards/catalog-query";
import { listVouchers } from "@/lib/rewards/rewards-service";
import {
  CATEGORY_LABELS,
  SORT_LABELS,
} from "@/lib/rewards/voucher-display";
import { useRewardsCatalog } from "../hooks/use-rewards-catalog";
import { useRewardsFilters } from "../hooks/use-rewards-filters";
import { BalanceCard } from "./BalanceCard";
import { FilterPanel } from "./FilterPanel";
import { FilterSheet } from "./FilterSheet";
import { FlashSaleStrip } from "./FlashSaleStrip";
import { RewardsEmptyState } from "./RewardsEmptyState";
import { RewardsErrorState } from "./RewardsErrorState";
import { FlashStripSkeleton, ListSkeleton } from "./RewardsSkeleton";
import { VoucherCard } from "./VoucherCard";

export function RewardsScreen() {
  const { filters, setFilters, resetFilters } = useRewardsFilters();
  const [searchInput, setSearchInput] = useState(filters.q);
  // The URL is the source of truth for q; typing writes to it after 300 ms.
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pushedQ = useRef(filters.q);

  const cancelSearchTimer = () => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = null;
  };

  const commitSearch = (value: string) => {
    const q = value.trim().slice(0, 100);
    pushedQ.current = q;
    setFilters({ q }, "replace");
  };

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    cancelSearchTimer();
    searchTimer.current = setTimeout(() => commitSearch(value), 300);
  };

  const handleSearchClear = () => {
    cancelSearchTimer();
    setSearchInput("");
    commitSearch("");
  };

  // q changed by something other than our own write (reset, chips, Back/Forward): resync the box.
  useEffect(() => {
    if (filters.q === pushedQ.current) return;
    pushedQ.current = filters.q;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = null;
    setSearchInput(filters.q);
  }, [filters.q]);

  // A pending write must not navigate after the page is left.
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    },
    [],
  );

  const handleReset = () => {
    cancelSearchTimer();
    pushedQ.current = "";
    setSearchInput("");
    resetFilters();
  };

  const [sheetOpen, setSheetOpen] = useState(false);

  const {
    catalog,
    stale,
    flashSales,
    flashLoading,
    error,
    offsetMs,
    reloadAll,
    loadMore,
    loadingMore,
    loadMoreFailed,
  } = useRewardsCatalog(filters);

  const filterCount = activeFilterCount(filters);

  // A failed query for new filters shows the error, not the previous filters' list.
  const catalogFailed = Boolean(error) && (stale || !catalog);
  const isEmpty = Boolean(catalog) && !catalogFailed && catalog?.items.length === 0;

  // Suggestions are fetched only while the empty state is on screen.
  const suggestionsQuery = useApiQuery(
    isEmpty ? "rewards-suggestions" : null,
    useCallback((signal) => listVouchers("limit=4", signal), []),
  );
  const suggestions = (suggestionsQuery.data?.items ?? [])
    .filter((item) => item.status === "AVAILABLE")
    .slice(0, 2);

  // Split list by available vs sold-out/expired for divider
  const items = catalog?.items ?? [];
  const firstInactiveIndex = items.findIndex(
    (item) => item.status === "SOLD_OUT" || item.status === "EXPIRED",
  );

  const sortOptions = VOUCHER_SORTS.map((s) => ({
    value: s,
    label: SORT_LABELS[s],
  }));

  const handleCategoryChipClick = (cat: VoucherCategory | "ALL") => {
    if (cat === "ALL") {
      setFilters({ category: [] });
    } else {
      const next = filters.category.includes(cat)
        ? filters.category.filter((c) => c !== cat)
        : [cat];
      setFilters({ category: next });
    }
  };

  const handleApplyStaged = (staged: RewardsFilters) => {
    setFilters(staged);
  };

  return (
    <div className="min-h-full pb-24 lg:pb-12">
      {/* Mobile Back Bar (< lg) */}
      <MobileBackBar title="Đổi quà" backHref="/wallet" />

      <main className="mx-auto max-w-7xl px-4 py-4 md:px-6 md:py-6 lg:px-8">
        <div className="flex flex-col lg:flex-row lg:items-start lg:gap-8">
          {/* Desktop Left Aside (264px) */}
          <aside className="hidden lg:flex lg:w-[264px] lg:shrink-0 lg:flex-col lg:gap-6">
            <BalanceCard
              available={catalog?.viewer.available ?? null}
              pending={catalog?.viewer.pending ?? 0}
            />
            <FilterPanel
              filters={filters}
              onChange={(patch) => setFilters(patch)}
              onReset={handleReset}
            />
          </aside>

          {/* Main content area */}
          <div className="flex-1 min-w-0 flex flex-col gap-5">
            {/* Mobile Balance Card (< lg) */}
            <div className="lg:hidden">
              <BalanceCard
                available={catalog?.viewer.available ?? null}
                pending={catalog?.viewer.pending ?? 0}
              />
            </div>

            {/* Mobile Search & Category Chips (< lg) */}
            <div className="flex flex-col gap-3 lg:hidden">
              <div className="relative flex items-center">
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Tìm voucher hoặc thương hiệu"
                  className="h-12 w-full rounded-control border border-line bg-surface pl-11 pr-10 text-body text-ink placeholder:text-ink-placeholder focus:border-primary focus:outline-none"
                />
                <span className="pointer-events-none absolute left-3.5 text-ink-muted">
                  <Icon name="search" size={20} />
                </span>
                {searchInput ? (
                  <button
                    type="button"
                    onClick={handleSearchClear}
                    className="absolute right-3.5 text-ink-muted hover:text-ink cursor-pointer"
                    aria-label="Xoá tìm kiếm"
                  >
                    <Icon name="x" size={18} />
                  </button>
                ) : null}
              </div>

              {/* Horizontal Category chips scroll row + filter button */}
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center gap-2 overflow-x-auto py-1 no-scrollbar">
                  <ToggleChip
                    size="lg"
                    selected={filters.category.length === 0}
                    onSelectedChange={() => handleCategoryChipClick("ALL")}
                  >
                    Tất cả
                  </ToggleChip>
                  {VOUCHER_CATEGORIES.map((cat) => (
                    <ToggleChip
                      key={cat}
                      size="lg"
                      selected={filters.category.includes(cat)}
                      onSelectedChange={() => handleCategoryChipClick(cat)}
                    >
                      {CATEGORY_LABELS[cat]}
                    </ToggleChip>
                  ))}
                </div>

                <div className="relative shrink-0">
                  <IconButton
                    icon="sliders"
                    label="Bộ lọc"
                    onClick={() => setSheetOpen(true)}
                    className="h-11 w-11 rounded-full border border-line-strong bg-surface"
                  />
                  {filterCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white shadow-xs">
                      {filterCount}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Flash Sale strip */}
            {flashSales && flashSales.items.length > 0 && (
              <FlashSaleStrip
                flashSales={flashSales}
                offsetMs={offsetMs}
                onCountdownElapsed={reloadAll}
              />
            )}
            {!flashSales && flashLoading && <FlashStripSkeleton />}

            {/* Desktop List Header (≥ lg) */}
            <div className="hidden lg:flex lg:items-center lg:justify-between lg:gap-4 border-b border-line-subtle pb-4">
              <div className="flex flex-col">
                <h1 className="text-title-sm font-extrabold text-ink">Tất cả voucher</h1>
                <p className="text-caption text-ink-muted">
                  {catalog ? `${catalog.total} voucher · giá đã gồm ưu đãi đang chạy` : "Đang tải..."}
                </p>
              </div>

              <div className="flex items-center gap-3">
                {/* 320px search */}
                <div className="relative w-[320px]">
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    placeholder="Tìm voucher hoặc thương hiệu"
                    className="h-11 w-full rounded-control border border-line bg-surface pl-10 pr-9 text-body-sm text-ink placeholder:text-ink-placeholder focus:border-primary focus:outline-none"
                  />
                  <span className="pointer-events-none absolute left-3 top-3 text-ink-muted">
                    <Icon name="search" size={18} />
                  </span>
                  {searchInput && (
                    <button
                      type="button"
                      onClick={handleSearchClear}
                      aria-label="Xoá tìm kiếm"
                      className="absolute right-3 top-3 text-ink-muted hover:text-ink cursor-pointer"
                    >
                      <Icon name="x" size={16} />
                    </button>
                  )}
                </div>

                {/* Desktop Sort: label + 220×48 select (Figma 122:647) */}
                <label
                  htmlFor="desktop-sort-select"
                  className="text-caption font-medium text-ink-muted"
                >
                  Sắp xếp
                </label>
                <Select
                  id="desktop-sort-select"
                  height={48}
                  className="w-[220px]"
                  value={filters.sort}
                  options={sortOptions}
                  onChange={(e) => setFilters({ sort: e.target.value as VoucherSort })}
                />
              </div>
            </div>

            {/* Mobile List Header (< lg) */}
            <div className="flex items-center justify-between lg:hidden">
              <div className="flex flex-col">
                <span className="text-label font-bold text-ink">Tất cả voucher</span>
                {catalog && (
                  <span className="text-caption text-ink-muted">{catalog.total} voucher</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                className="flex items-center gap-1 text-label font-bold text-ink-muted hover:text-ink cursor-pointer"
              >
                <span>{SORT_LABELS[filters.sort]}</span>
                <Icon name="chevron-down" size={16} />
              </button>
            </div>

            {/* Content states */}
            {!catalog && !error && <ListSkeleton />}

            {catalogFailed && <RewardsErrorState onRetry={reloadAll} />}

            {/* While new filters load the previous list stays (dimmed) instead of blanking. */}
            {catalog && !catalogFailed && (
              <div className={stale ? "opacity-60 transition-opacity" : undefined} aria-busy={stale}>
                {isEmpty ? (
                  <RewardsEmptyState
                    searchQuery={filters.q}
                    filters={filters}
                    activeFilterCount={filterCount}
                    onChangeFilters={(patch) => setFilters(patch)}
                    onClearFilters={handleReset}
                    suggestions={suggestions}
                  />
                ) : (
                  <div className="flex flex-col gap-4">
                    {/* Mobile: Row cards */}
                    <div className="flex flex-col gap-3 lg:hidden">
                      {items.map((item, idx) => (
                        <div key={item.id} className="flex flex-col gap-3">
                          {firstInactiveIndex !== -1 && idx === firstInactiveIndex && (
                            <div className="my-2 border-t border-line-subtle pt-3">
                              <p className="text-caption font-semibold text-ink-muted">
                                Đã hết hàng hoặc hết thời gian đổi
                              </p>
                            </div>
                          )}
                          <VoucherCard item={item} layout="row" />
                        </div>
                      ))}
                    </div>

                    {/* Desktop: 4-column Tile grid */}
                    <div className="hidden lg:grid lg:grid-cols-4 lg:gap-4">
                      {items.map((item, idx) => (
                        <div key={item.id} className="contents">
                          {firstInactiveIndex !== -1 && idx === firstInactiveIndex && (
                            <div className="col-span-4 my-2 border-t border-line-subtle pt-3">
                              <p className="text-caption font-semibold text-ink-muted">
                                Đã hết hàng hoặc hết thời gian đổi
                              </p>
                            </div>
                          )}
                          <VoucherCard item={item} layout="tile" />
                        </div>
                      ))}
                    </div>

                    {/* Pagination: next page is appended (offset), the filter query is unchanged */}
                    {catalog.hasMore && (
                      <div className="mt-4 flex flex-col items-center gap-2">
                        {loadMoreFailed && (
                          <p className="text-caption text-danger" role="alert">
                            Chưa tải thêm được. Thử lại nhé.
                          </p>
                        )}
                        <Button
                          variant="secondary"
                          size="md"
                          onClick={loadMore}
                          disabled={stale}
                          loading={loadingMore}
                        >
                          Xem thêm
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Filter Bottom Sheet (Mobile) */}
      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filters={filters}
        onApply={handleApplyStaged}
      />
    </div>
  );
}
