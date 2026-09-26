"use client";

import React from "react";
import type { MarketplaceSortOption } from "@rescom/schemas";

interface MarketplaceFilterBarProps {
  search: string;
  onSearchChange: (search: string) => void;
  sortBy: MarketplaceSortOption;
  onSortChange: (sort: MarketplaceSortOption) => void;
  typeFilter: "ALL" | "INTERNAL" | "EXTERNAL";
  onTypeChange: (type: "ALL" | "INTERNAL" | "EXTERNAL") => void;
  hideCompleted: boolean;
  onHideCompletedChange: (hide: boolean) => void;
  onResetFilters: () => void;
  hasActiveFilters: boolean;
}

export function MarketplaceFilterBar({
  search,
  onSearchChange,
  sortBy,
  onSortChange,
  typeFilter,
  onTypeChange,
  hideCompleted,
  onHideCompletedChange,
  onResetFilters,
  hasActiveFilters,
}: MarketplaceFilterBarProps) {
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 mb-6 shadow-xs">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Search input */}
        <div className="relative flex-1 min-w-[240px]">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Tìm kiếm theo tiêu đề hoặc mô tả đề tài nghiên cứu..."
            className="w-full pl-9 pr-8 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearchChange("")}
              className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label="Xóa từ khóa tìm kiếm"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Controls row */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          {/* Sort selector */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="marketplace-sort" className="text-slate-500 dark:text-slate-400 whitespace-nowrap font-semibold">
              Sắp xếp:
            </label>
            <select
              id="marketplace-sort"
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value as MarketplaceSortOption)}
              className="py-1.5 px-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 text-xs font-medium cursor-pointer"
            >
              <option value="best_match">🎯 Phù hợp nhất</option>
              <option value="reward_desc">🪙 Điểm thưởng cao nhất</option>
              <option value="reward_asc">🪙 Điểm thưởng thấp nhất</option>
              <option value="duration_asc">⏱️ Thời gian ngắn nhất</option>
              <option value="duration_desc">⏱️ Thời gian dài nhất</option>
              <option value="newest">🆕 Mới nhất</option>
            </select>
          </div>

          {/* Type filter */}
          <div className="flex items-center gap-1.5">
            <label htmlFor="marketplace-type" className="text-slate-500 dark:text-slate-400 whitespace-nowrap font-semibold">
              Hình thức:
            </label>
            <select
              id="marketplace-type"
              value={typeFilter}
              onChange={(e) => onTypeChange(e.target.value as "ALL" | "INTERNAL" | "EXTERNAL")}
              className="py-1.5 px-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 text-xs font-medium cursor-pointer"
            >
              <option value="ALL">Tất cả hình thức</option>
              <option value="INTERNAL">Nội bộ (RESCOM)</option>
              <option value="EXTERNAL">Biểu mẫu ngoài (Google Forms)</option>
            </select>
          </div>

          {/* Hide Completed toggle */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none text-slate-600 dark:text-slate-300 font-medium pl-1">
            <input
              type="checkbox"
              checked={hideCompleted}
              onChange={(e) => onHideCompletedChange(e.target.checked)}
              className="w-3.5 h-3.5 rounded text-emerald-600 border-slate-300 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 cursor-pointer"
            />
            <span>Ẩn đã làm</span>
          </label>

          {/* Reset Filters */}
          {hasActiveFilters && (
            <button
              type="button"
              onClick={onResetFilters}
              className="px-2 py-1 text-xs text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 font-bold underline transition-colors cursor-pointer"
            >
              Xóa bộ lọc
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
