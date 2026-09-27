"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Select } from "@/components/ui/Select";
import {
  activeFilterCount,
  MARKETPLACE_SORTS,
  normalizeSearch,
  SEARCH_MAX_LENGTH,
  SORT_LABELS,
  type MarketplaceFilters,
  type MarketplaceSort,
} from "@/lib/marketplace/marketplace-query";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { FilterPanel } from "./FilterPanel";

type SetFilters = (patch: Partial<MarketplaceFilters>, mode?: "push" | "replace") => void;

const SEARCH_DEBOUNCE_MS = 350;
const SORT_OPTIONS = MARKETPLACE_SORTS.map((value) => ({ value, label: SORT_LABELS[value] }));

/**
 * Search box — desktop 62:649 (350 × 46, 18px icon), mobile 62:1291
 * (full width × 50, 14px radius, 20px icon). Typing is debounced into `?q=`.
 */
function SearchField({ search, setFilters }: { search: string; setFilters: SetFilters }) {
  const [draft, setDraft] = useState(search);
  const [syncedSearch, setSyncedSearch] = useState(search);
  const debounced = useDebouncedValue(draft, SEARCH_DEBOUNCE_MS);

  // URL → box (back/forward, "Xoá bộ lọc"), without clobbering what is being typed.
  if (search !== syncedSearch) {
    setSyncedSearch(search);
    if (normalizeSearch(draft) !== search) setDraft(search);
  }

  // Box → URL once typing pauses. `setFilters` compares with the live URL, so
  // this is a no-op when the URL already holds the value.
  useEffect(() => {
    setFilters({ search: debounced }, "replace");
  }, [debounced, setFilters]);

  return (
    <div className="relative w-full lg:w-[350px]">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted">
        <span className="lg:hidden">
          <Icon name="search" size={20} />
        </span>
        <span className="hidden lg:inline">
          <Icon name="search" size={18} />
        </span>
      </span>
      <input
        type="search"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        maxLength={SEARCH_MAX_LENGTH}
        aria-label="Tìm khảo sát theo chủ đề"
        // Real placeholder is the span below: Figma words it differently per breakpoint.
        placeholder=" "
        className="peer h-12.5 w-full rounded-control border border-line-strong bg-surface pl-11.5 pr-3.5 text-body text-ink transition-colors [--focus-ring-color:transparent] hover:border-ink-strong focus:border-2 focus:border-primary focus:pl-[45px] focus:pr-[13px] lg:h-11.5 lg:rounded-field"
      />
      <span className="pointer-events-none absolute left-11.5 top-1/2 hidden -translate-y-1/2 truncate text-body text-ink-placeholder peer-placeholder-shown:block">
        <span className="lg:hidden">Tìm khảo sát theo chủ đề</span>
        <span className="hidden lg:inline">Tìm theo chủ đề</span>
      </span>
    </div>
  );
}

/** Mobile sort chips 62:1296 — selected = ink pill with a check. */
function SortChips({ sort, setFilters }: { sort: MarketplaceSort; setFilters: SetFilters }) {
  return (
    <div role="group" aria-label="Sắp xếp" className="flex gap-2 overflow-x-auto pr-12 [scrollbar-width:none]">
      {MARKETPLACE_SORTS.map((value) => {
        const selected = value === sort;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={selected}
            onClick={() => setFilters({ sort: value })}
            className={[
              "inline-flex h-9.5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-label transition-colors",
              selected
                ? "bg-ink font-bold text-primary-foreground"
                : "border border-line-strong bg-surface font-semibold text-ink hover:border-ink-muted hover:bg-surface-subtle",
            ].join(" ")}
          >
            {selected ? <Icon name="check" size={14} /> : null}
            {SORT_LABELS[value]}
          </button>
        );
      })}
    </div>
  );
}

interface MarketplaceToolbarProps {
  filters: MarketplaceFilters;
  setFilters: SetFilters;
  resetFilters: () => void;
}

/** Heading + search + sort (desktop row 62:648–62:657; mobile 62:1291–62:1305) and the mobile filter sheet. */
export function MarketplaceToolbar({ filters, setFilters, resetFilters }: MarketplaceToolbarProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeCount = activeFilterCount(filters);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
      <h1 className="sr-only lg:not-sr-only lg:mr-auto lg:text-[24px] lg:font-extrabold lg:text-ink">
        Khảo sát dành cho bạn
      </h1>
      <SearchField search={filters.search} setFilters={setFilters} />

      <div className="hidden items-center gap-4 lg:flex">
        <label htmlFor="marketplace-sort" className="whitespace-nowrap text-label font-semibold text-ink-muted">
          Sắp xếp
        </label>
        <Select
          id="marketplace-sort"
          height={44}
          className="w-[159px]"
          options={SORT_OPTIONS}
          value={filters.sort}
          onChange={(event) => setFilters({ sort: event.target.value as MarketplaceSort })}
        />
      </div>

      <div className="relative lg:hidden">
        <SortChips sort={filters.sort} setFilters={setFilters} />
        <button
          type="button"
          onClick={() => setFiltersOpen(true)}
          aria-haspopup="dialog"
          aria-label={activeCount > 0 ? `Bộ lọc (${activeCount} đang chọn)` : "Bộ lọc"}
          className="absolute right-0 top-0 inline-flex size-9.5 items-center justify-center rounded-full border border-line-strong bg-surface text-ink hover:bg-surface-subtle"
        >
          <Icon name="sliders" size={18} />
          {activeCount > 0 ? (
            <span aria-hidden className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface bg-primary" />
          ) : null}
        </button>
      </div>

      {/* ASSUMED: mobile filter sheet (not drawn) — same controls as the desktop sidebar. */}
      <Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} labelledBy="marketplace-filters-title" width={480}>
        <div className="flex flex-col gap-6 p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 id="marketplace-filters-title" className="text-[20px] font-extrabold text-ink">
              Bộ lọc
            </h2>
            <IconButton icon="x" label="Đóng bộ lọc" onClick={() => setFiltersOpen(false)} />
          </div>
          <FilterPanel idPrefix="sheet" filters={filters} onChange={(patch) => setFilters(patch)} />
          <div className="flex gap-3">
            <Button variant="secondary" size="base" radius="field" className="flex-1" onClick={resetFilters}>
              Xoá bộ lọc
            </Button>
            <Button size="base" radius="field" className="flex-1" onClick={() => setFiltersOpen(false)}>
              Xem kết quả
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
