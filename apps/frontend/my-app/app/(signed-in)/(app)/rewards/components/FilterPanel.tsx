"use client";

import {
  POINT_RANGES,
  REWARDS_BRANDS,
  type RewardsFilters,
} from "@/lib/rewards/catalog-query";
import { Checkbox } from "@/components/ui/Checkbox";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { Toggle } from "@/components/ui/Toggle";
import {
  CATEGORY_LABELS,
} from "@/lib/rewards/voucher-display";
import { VOUCHER_CATEGORIES, type VoucherCategory } from "@rescom/schemas";

interface FilterPanelProps {
  filters: RewardsFilters;
  onChange: (patch: Partial<RewardsFilters>) => void;
  onReset: () => void;
  className?: string;
}

export function FilterPanel({ filters, onChange, onReset, className = "" }: FilterPanelProps) {
  const toggleCategory = (cat: VoucherCategory) => {
    const next = filters.category.includes(cat)
      ? filters.category.filter((c) => c !== cat)
      : [...filters.category, cat];
    onChange({ category: next });
  };

  const toggleBrand = (brandId: string) => {
    const next = filters.brand.includes(brandId)
      ? filters.brand.filter((b) => b !== brandId)
      : [...filters.brand, brandId];
    onChange({ brand: next });
  };

  const selectPoints = (rangeId: "lt100" | "100-200" | "gt200") => {
    onChange({ points: filters.points === rangeId ? null : rangeId });
  };

  return (
    <div className={`flex flex-col gap-6 rounded-[24px] border border-line bg-surface p-5 shadow-xs ${className}`}>
      <div className="flex items-center justify-between border-b border-line-subtle pb-3">
        <h2 className="text-body font-bold text-ink">Bộ lọc</h2>
        <button
          type="button"
          onClick={onReset}
          className="text-label font-bold text-primary hover:underline cursor-pointer"
        >
          Đặt lại
        </button>
      </div>

      {/* Danh mục */}
      <div className="flex flex-col gap-2.5">
        <span className="text-label font-bold text-ink-muted uppercase tracking-wider text-[11px]">
          Danh mục
        </span>
        <div className="flex flex-col gap-2">
          {VOUCHER_CATEGORIES.map((cat) => (
            <Checkbox
              key={cat}
              id={`filter-cat-${cat}`}
              label={CATEGORY_LABELS[cat]}
              checked={filters.category.includes(cat)}
              onChange={() => toggleCategory(cat)}
            />
          ))}
        </div>
      </div>

      {/* Thương hiệu */}
      <div className="flex flex-col gap-2.5">
        <span className="text-label font-bold text-ink-muted uppercase tracking-wider text-[11px]">
          Thương hiệu
        </span>
        <div className="flex flex-col gap-2">
          {REWARDS_BRANDS.map((brand) => (
            <Checkbox
              key={brand.id}
              id={`filter-brand-${brand.id}`}
              label={brand.name}
              checked={filters.brand.includes(brand.id)}
              onChange={() => toggleBrand(brand.id)}
            />
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
              selected={filters.points === range.id}
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
          checked={filters.sale}
          onCheckedChange={(sale) => onChange({ sale })}
        />
        <Toggle
          label="Chỉ voucher tôi đủ điểm đổi"
          checked={filters.afford}
          onCheckedChange={(afford) => onChange({ afford })}
        />
      </div>
    </div>
  );
}
