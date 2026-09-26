"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type {
  MarketplaceSurveyCardDto,
  MarketplaceSortOption,
} from "@rescom/schemas";
import { MarketplaceCard } from "./MarketplaceCard";
import { MarketplaceFilterBar } from "./MarketplaceFilterBar";
import { mockRepository } from "@/lib/mock/repository.ts";
import { PortalShell } from "@/components/layout/PortalShell";
import { isDemographicProfileRequiredError } from "@/lib/onboarding.ts";
import { useRequireCompletedOnboarding } from "@/lib/use-onboarding-guard.ts";
import { ActivationCard } from "@/components/activation/ActivationCard";
import { useDebouncedValue } from "@/lib/use-debounced-value.ts";

const SEARCH_DEBOUNCE_MS = 300;

interface FeedResult {
  /** The request (filters + reload) this result answers. */
  key: string;
  surveys: MarketplaceSurveyCardDto[];
  error: string | null;
}

function MarketplaceLoading({ label }: { label: string }) {
  return (
    <div className="py-20 text-center text-slate-400" role="status">
      <div className="inline-block animate-spin rounded-full h-8 w-8 border-3 border-slate-200 border-t-emerald-600 mb-3" />
      <p className="text-xs font-semibold">{label}</p>
    </div>
  );
}

export default function MarketplacePage() {
  return (
    <PortalShell>
      <Suspense fallback={<MarketplaceLoading label="Đang mở Chợ khảo sát..." />}>
        <MarketplaceContent />
      </Suspense>
    </PortalShell>
  );
}

function MarketplaceContent() {
  // Story 7.1 (FR-6): no Marketplace before the Mandatory Demographic Survey.
  const { ready, redirectToOnboarding } = useRequireCompletedOnboarding();
  const searchParams = useSearchParams();
  // Story 7.2 (FR-7): the activation step is shown to every not-yet-activated
  // respondent; the 7.1 handoff (`?activation=1`) only highlights it.
  const isActivationHandoff = searchParams.get("activation") === "1";

  const [feed, setFeed] = useState<FeedResult | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);

  // Filter & Sort State
  const [search, setSearch] = useState<string>("");
  const [sortBy, setSortBy] = useState<MarketplaceSortOption>("best_match");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "INTERNAL" | "EXTERNAL">("ALL");
  const [hideCompleted, setHideCompleted] = useState<boolean>(true);
  const debouncedSearch = useDebouncedValue(search, SEARCH_DEBOUNCE_MS);
  const trimmedSearch = debouncedSearch.trim();

  // Every filter change or retry is a new request. Loading/error/results are
  // derived from whether the stored result answers the CURRENT request, so a
  // new request always starts in the loading state with no stale error, and
  // old results are never shown under new filters (Epic 4 review P18).
  const requestKey = JSON.stringify([
    reloadKey,
    trimmedSearch,
    sortBy,
    typeFilter,
    hideCompleted,
  ]);
  const isCurrent = feed !== null && feed.key === requestKey;
  const loading = !isCurrent;
  const surveys = isCurrent ? feed.surveys : [];
  const error = isCurrent ? feed.error : null;

  const hasActiveFilters =
    search.trim() !== "" ||
    sortBy !== "best_match" ||
    typeFilter !== "ALL" ||
    !hideCompleted;

  const handleResetFilters = useCallback(() => {
    setSearch("");
    setSortBy("best_match");
    setTypeFilter("ALL");
    setHideCompleted(true);
  }, []);

  const refreshData = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!ready) return;
    let active = true;

    async function fetchData() {
      try {
        const feedData = await mockRepository.getMarketplaceFeed({
          search: trimmedSearch ? trimmedSearch : undefined,
          sortBy,
          type: typeFilter,
          hideCompleted,
        });

        if (active) {
          setFeed({ key: requestKey, surveys: feedData.surveys || [], error: null });
        }
      } catch (err: unknown) {
        if (active && isDemographicProfileRequiredError(err)) {
          redirectToOnboarding();
          return;
        }
        if (active) {
          const msg =
            err instanceof Error
              ? err.message
              : "Có lỗi khi tải dữ liệu Chợ khảo sát.";
          // Never keep the previous list under the new filters.
          setFeed({ key: requestKey, surveys: [], error: msg });
        }
      }
    }

    void fetchData();

    return () => {
      active = false;
    };
  }, [ready, redirectToOnboarding, requestKey, trimmedSearch, sortBy, typeFilter, hideCompleted]);

  if (!ready) {
    return <MarketplaceLoading label="Đang kiểm tra hồ sơ nhân khẩu học..." />;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Navigation Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-8 pb-4 border-b border-slate-200/80 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              Chợ Khảo Sát Nghiên Cứu
            </h1>
            <span className="px-2.5 py-0.5 text-xs font-bold rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              Khám phá & Nhận điểm
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Tham gia khảo sát được phân phối tự động dựa trên hồ sơ nhân khẩu học để tích lũy điểm thưởng.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/dashboard"
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Tổng quan
          </Link>
          <Link
            href="/wallet"
            className="px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Ví điểm
          </Link>
          <Link
            href="/forms"
            className="px-3.5 py-2 text-xs font-bold rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 transition-colors"
          >
            Tạo khảo sát
          </Link>
        </div>
      </div>

      {/* Marketplace activation step (Story 7.2, FR-7/FR-8) */}
      <ActivationCard variant="marketplace" highlightHandoff={isActivationHandoff} />

      {/* Error alert with retry button */}
      {error && (
        <div className="mb-6 p-4 rounded-3xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900 text-xs flex items-center justify-between">
          <span>{error}</span>
          <button
            type="button"
            onClick={refreshData}
            className="px-3 py-1 bg-rose-600 text-white font-bold rounded-lg hover:bg-rose-700 transition-colors ml-3 cursor-pointer"
          >
            Thử lại
          </button>
        </div>
      )}

      {/* Filter and Sorting Controls Bar */}
      <MarketplaceFilterBar
        search={search}
        onSearchChange={setSearch}
        sortBy={sortBy}
        onSortChange={setSortBy}
        typeFilter={typeFilter}
        onTypeChange={setTypeFilter}
        hideCompleted={hideCompleted}
        onHideCompletedChange={setHideCompleted}
        onResetFilters={handleResetFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {/* Surveys List Section Header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            Khảo sát đang mở
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {loading
              ? "Đang so khớp tiêu chí đối tượng..."
              : `Tìm thấy ${surveys.length} khảo sát phù hợp với bạn`}
          </p>
        </div>

        <button
          type="button"
          onClick={refreshData}
          disabled={loading}
          className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer"
        >
          <svg
            className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Làm mới
        </button>
      </div>

      {/* Feed List Grid */}
      {loading ? (
        <MarketplaceLoading label="Đang lọc và so khớp khảo sát..." />
      ) : surveys.length === 0 ? (
        <div className="py-16 text-center bg-white dark:bg-slate-900 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl p-8 shadow-xs">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto mb-3 text-xl">
            🔍
          </div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">
            {hasActiveFilters
              ? "Không tìm thấy khảo sát phù hợp với bộ lọc"
              : "Chưa có khảo sát phù hợp lúc này"}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-4 leading-relaxed">
            {hasActiveFilters
              ? "Hãy thử tìm kiếm với từ khóa rộng hơn, thay đổi tiêu chí sắp xếp hoặc xóa bộ lọc."
              : "Tất cả các khảo sát hiện tại nhắm đến đối tượng khác hoặc bạn đã hoàn thành hết. Hãy quay lại sau khi có đề tài mới nhé!"}
          </p>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={handleResetFilters}
              className="px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors cursor-pointer"
            >
              Xóa tất cả bộ lọc
            </button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {surveys.map((survey) => (
            <MarketplaceCard key={survey.id} survey={survey} />
          ))}
        </div>
      )}
    </div>
  );
}
