import type { VoucherListItemDto } from "@rescom/schemas";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { POINT_RANGES, REWARDS_BRANDS, type RewardsFilters } from "@/lib/rewards/catalog-query";
import { CATEGORY_LABELS } from "@/lib/rewards/voucher-display";
import { VoucherCard } from "./VoucherCard";

interface RewardsEmptyStateProps {
  searchQuery?: string;
  filters: RewardsFilters;
  activeFilterCount: number;
  /** Removes one active filter (a patch that clears just that value). */
  onChangeFilters: (patch: Partial<RewardsFilters>) => void;
  onClearFilters: () => void;
  suggestions?: VoucherListItemDto[];
}

function activeFilterChips(
  filters: RewardsFilters,
  onChange: (patch: Partial<RewardsFilters>) => void,
): { key: string; label: string; remove: () => void }[] {
  const chips = [
    ...filters.category.map((cat) => ({
      key: `category-${cat}`,
      label: CATEGORY_LABELS[cat],
      remove: () => onChange({ category: filters.category.filter((c) => c !== cat) }),
    })),
    ...filters.brand.map((id) => ({
      key: `brand-${id}`,
      label: REWARDS_BRANDS.find((b) => b.id === id)?.name ?? id,
      remove: () => onChange({ brand: filters.brand.filter((b) => b !== id) }),
    })),
  ];
  const range = POINT_RANGES.find((r) => r.id === filters.points);
  if (range) chips.push({ key: "points", label: `${range.label} điểm`, remove: () => onChange({ points: null }) });
  if (filters.sale) chips.push({ key: "sale", label: "Đang giảm giá", remove: () => onChange({ sale: false }) });
  if (filters.afford) chips.push({ key: "afford", label: "Đủ điểm đổi", remove: () => onChange({ afford: false }) });
  return chips;
}

export function RewardsEmptyState({
  searchQuery,
  filters,
  activeFilterCount,
  onChangeFilters,
  onClearFilters,
  suggestions = [],
}: RewardsEmptyStateProps) {
  const chips = activeFilterChips(filters, onChangeFilters);
  const title = searchQuery
    ? `Chưa có voucher cho “${searchQuery}”`
    : "Chưa có voucher phù hợp";

  const body =
    activeFilterCount > 0
      ? `Thử tên thương hiệu khác, hoặc bỏ bớt ${activeFilterCount} bộ lọc đang bật.`
      : "Thử tìm kiếm với từ khoá khác hoặc quay lại sau nhé.";

  return (
    <div className="flex flex-col gap-4">
      {chips.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Bộ lọc đang bật">
          {chips.map((chip) => (
            <li key={chip.key}>
              <button
                type="button"
                onClick={chip.remove}
                aria-label={`Bỏ bộ lọc ${chip.label}`}
                className="inline-flex h-9.5 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border-2 border-primary bg-tone-green-bg px-3.5 text-label font-bold text-primary-strong"
              >
                {chip.label}
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col items-center justify-center py-10 text-center">
      {/* Search mascot */}
      <div className="relative mb-3 h-28 w-28">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/mascots/search.svg" alt="" className="h-full w-full object-contain" />
      </div>

      <h3 className="text-title-sm font-bold text-ink">{title}</h3>
      <p className="mt-1 text-body text-ink-muted max-w-sm">{body}</p>

      {activeFilterCount > 0 || searchQuery ? (
        <div className="mt-4">
          <Button variant="secondary" size="md" onClick={onClearFilters}>
            Xoá bộ lọc
          </Button>
        </div>
      ) : null}

      {suggestions.length > 0 && (
        <div className="mt-10 w-full text-left">
          <h4 className="text-body font-bold text-ink mb-3">Có thể bạn thích</h4>
          <div className="flex flex-col gap-3">
            {suggestions.slice(0, 2).map((item) => (
              <VoucherCard key={item.id} item={item} layout="row" />
            ))}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
