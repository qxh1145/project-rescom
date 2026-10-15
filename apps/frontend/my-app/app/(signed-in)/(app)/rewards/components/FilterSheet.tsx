"use client";

import { useEffect, useState } from "react";
import { VOUCHER_CATEGORIES, VOUCHER_SORTS, type VoucherCategory } from "@rescom/schemas";
import { Dialog } from "@/components/ui/Dialog";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { Toggle } from "@/components/ui/Toggle";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import {
  DEFAULT_REWARDS_FILTERS,
  POINT_RANGES,
  REWARDS_BRANDS,
  toCatalogQuery,
  type RewardsFilters,
} from "@/lib/rewards/catalog-query";
import {
  CATEGORY_LABELS,
  SORT_LABELS,
} from "@/lib/rewards/voucher-display";
import { listVouchers } from "@/lib/rewards/rewards-service";
import { useDebouncedValue } from "@/lib/use-debounced-value";

interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  filters: RewardsFilters;
  onApply: (staged: RewardsFilters) => void;
}

export function FilterSheet({ open, onClose, filters, onApply }: FilterSheetProps) {
  const [prevOpen, setPrevOpen] = useState(open);
  const [staged, setStaged] = useState<RewardsFilters>(filters);
  // Count of the staged query it was fetched for; shown only while it still matches (never a stale number).
  const [counted, setCounted] = useState<{ query: string; total: number } | null>(null);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setStaged(filters);
      setCounted(null);
    }
  }

  const stagedQuery = toCatalogQuery({ ...staged, sort: "BEST_DEAL" });
  const debouncedQuery = useDebouncedValue(stagedQuery, 250);
  const voucherCount = counted?.query === stagedQuery ? counted.total : null;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const params = new URLSearchParams(debouncedQuery);
    params.set("limit", "1");
    listVouchers(params.toString(), controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) setCounted({ query: debouncedQuery, total: res.total });
      })
      .catch(() => {
        // Aborted or failed: the count stays unknown and the button reads "Xem voucher".
        if (!controller.signal.aborted) setCounted(null);
      });
    return () => controller.abort();
  }, [open, debouncedQuery]);

  const toggleCategory = (cat: VoucherCategory) => {
    setStaged((prev) => ({
      ...prev,
      category: prev.category.includes(cat)
        ? prev.category.filter((c) => c !== cat)
        : [...prev.category, cat],
    }));
  };

  const toggleBrand = (brandId: string) => {
    setStaged((prev) => ({
      ...prev,
      brand: prev.brand.includes(brandId)
        ? prev.brand.filter((b) => b !== brandId)
        : [...prev.brand, brandId],
    }));
  };

  const selectPoints = (rangeId: "lt100" | "100-200" | "gt200") => {
    setStaged((prev) => ({
      ...prev,
      points: prev.points === rangeId ? null : rangeId,
    }));
  };

  const handleReset = () => {
    setStaged({
      ...DEFAULT_REWARDS_FILTERS,
      q: staged.q,
    });
  };

  const handleApply = () => {
    onApply(staged);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      labelledBy="filter-sheet-title"
      // Dialog applies `width` as an inline max-width: pass a bound no phone/tablet reaches so the sheet is full width.
      width={4096}
      className="m-0 mt-auto w-full! max-w-full rounded-b-none! rounded-t-[24px]! max-h-[90dvh]! overflow-hidden p-0 shadow-lg"
    >
      <div className="flex h-full max-h-[90dvh] flex-col">
        {/* Grab handle visual */}
        <div className="flex justify-center pt-3 pb-1">
          <span aria-hidden="true" className="h-1.25 w-10 rounded-full bg-line" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between border-b border-line-subtle px-5 py-3">
          <h2 id="filter-sheet-title" className="text-title-sm font-bold text-ink">
            Bộ lọc & Sắp xếp
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="text-label font-bold text-primary hover:underline cursor-pointer"
            >
              Đặt lại
            </button>
            <IconButton icon="x" label="Đóng" onClick={onClose} />
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 py-4">
          {/* Sắp xếp */}
          <div className="flex flex-col gap-2.5">
            <span className="text-label font-bold text-ink-muted uppercase tracking-wider text-[11px]">
              Sắp xếp
            </span>
            <div className="flex flex-wrap gap-2">
              {VOUCHER_SORTS.map((sortOption) => (
                <ToggleChip
                  key={sortOption}
                  size="lg"
                  selected={staged.sort === sortOption}
                  onSelectedChange={() => setStaged((prev) => ({ ...prev, sort: sortOption }))}
                >
                  {SORT_LABELS[sortOption]}
                </ToggleChip>
              ))}
            </div>
          </div>

          {/* Danh mục */}
          <div className="flex flex-col gap-2.5">
            <span className="text-label font-bold text-ink-muted uppercase tracking-wider text-[11px]">
              Danh mục
            </span>
            <div className="flex flex-wrap gap-2">
              {VOUCHER_CATEGORIES.map((cat) => (
                <ToggleChip
                  key={cat}
                  size="lg"
                  selected={staged.category.includes(cat)}
                  onSelectedChange={() => toggleCategory(cat)}
                >
                  {CATEGORY_LABELS[cat]}
                </ToggleChip>
              ))}
            </div>
          </div>

          {/* Thương hiệu */}
          <div className="flex flex-col gap-2.5">
            <span className="text-label font-bold text-ink-muted uppercase tracking-wider text-[11px]">
              Thương hiệu
            </span>
            <div className="flex flex-wrap gap-2">
              {REWARDS_BRANDS.map((brand) => (
                <ToggleChip
                  key={brand.id}
                  size="lg"
                  selected={staged.brand.includes(brand.id)}
                  onSelectedChange={() => toggleBrand(brand.id)}
                >
                  {brand.name}
                </ToggleChip>
              ))}
            </div>
          </div>

          {/* Khoảng điểm */}
          <div className="flex flex-col gap-2.5">
            <span className="text-label font-bold text-ink-muted uppercase tracking-wider text-[11px]">
              Khoảng điểm
            </span>
            <div className="flex flex-wrap gap-2">
              {POINT_RANGES.map((range) => (
                <ToggleChip
                  key={range.id}
                  size="lg"
                  selected={staged.points === range.id}
                  onSelectedChange={() => selectPoints(range.id)}
                >
                  {range.label}
                </ToggleChip>
              ))}
            </div>
          </div>

          {/* Toggles */}
          <div className="flex flex-col gap-2 border-t border-line-subtle pt-3">
            <Toggle
              label="Chỉ voucher đang giảm giá"
              checked={staged.sale}
              onCheckedChange={(sale) => setStaged((prev) => ({ ...prev, sale }))}
            />
            <Toggle
              label="Chỉ voucher tôi đủ điểm đổi"
              checked={staged.afford}
              onCheckedChange={(afford) => setStaged((prev) => ({ ...prev, afford }))}
            />
          </div>
        </div>

        {/* Sticky footer */}
        <div className="border-t border-line-subtle bg-surface px-5 py-4 pb-[calc(16px+env(safe-area-inset-bottom))]">
          <Button
            variant="primary"
            size="lg"
            className="w-full justify-center"
            onClick={handleApply}
          >
            {voucherCount !== null ? `Xem ${voucherCount} voucher` : "Xem voucher"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
