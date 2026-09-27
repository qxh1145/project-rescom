"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { MobileBrandBar } from "@/components/layout/app/MobileTopBar";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { useApiQuery } from "@/lib/api/use-api-query";
import { activationViewOf, getStarterPointsStatus } from "@/lib/economy/starter-points-service";
import { feedErrorMessage, MARKETPLACE_MESSAGES } from "@/lib/marketplace/marketplace-messages";
import {
  hasNarrowingFilters,
  matchesClientFilters,
  quickestSurveys,
  toFeedQueryParams,
} from "@/lib/marketplace/marketplace-query";
import { getMarketplaceFeed } from "@/lib/marketplace/marketplace-service";
import { buildOnboardingRedirect, isDemographicProfileRequiredError } from "@/lib/onboarding";
import { useSession } from "@/lib/session/SessionProvider";
import { useMarketplaceFilters } from "../hooks/use-marketplace-filters";
import { useStartSurvey } from "../hooks/use-start-survey";
import { ActivationBanner } from "./ActivationBanner";
import { FilterPanel } from "./FilterPanel";
import { MarketplaceEmptyState, NoMatchState } from "./MarketplaceEmptyState";
import { MarketplaceToolbar } from "./MarketplaceToolbar";
import { StarterExpiringSection } from "./StarterExpiringSection";
import { SurveyCard, SurveyCardSkeleton } from "./SurveyCard";

const SKELETON_COUNT = 6;

/**
 * Figma 3 "Khám phá khảo sát" — desktop 62:582 (filters sidebar + 3-column
 * grid), mobile 62:1250; empty state 3b (62:848); starter points expiring
 * 15f (63:1877).
 */
export function MarketplaceScreen() {
  const router = useRouter();
  const { balance } = useSession();
  const { filters, setFilters, resetFilters } = useMarketplaceFilters();
  const feedQuery = toFeedQueryParams(filters).toString();
  const feed = useApiQuery(`marketplace-feed:${feedQuery}`, (signal) => getMarketplaceFeed(filters, signal));
  // Best effort: without it the page simply has no activation card.
  const starter = useApiQuery("starter-points-status", getStarterPointsStatus);
  const { start, pendingId, notice, dismissNotice } = useStartSurvey();

  const profileRequired = isDemographicProfileRequiredError(feed.error);
  useEffect(() => {
    if (profileRequired) router.replace(buildOnboardingRedirect("/marketplace"));
  }, [profileRequired, router]);

  const surveys = useMemo(
    () => feed.data?.surveys.filter((survey) => matchesClientFilters(survey, filters)),
    [feed.data, filters],
  );
  const openSurveys = surveys?.filter((survey) => !survey.isCompletedByCurrentUser) ?? [];
  const activation = starter.data ? activationViewOf(starter.data) : { kind: "hidden" as const };
  const featuredId = openSurveys[0]?.id;

  const noOpenSurveys = surveys !== undefined && openSurveys.length === 0;
  const showEmptyState = noOpenSurveys && !hasNarrowingFilters(filters);
  const showNoMatch = surveys !== undefined && surveys.length === 0 && hasNarrowingFilters(filters);

  return (
    <>
      <MobileBrandBar />
      <div className="mx-auto w-full max-w-[1440px] px-5 pb-8 pt-4 lg:grid lg:grid-cols-[244px_minmax(0,1fr)] lg:gap-12 lg:px-12 lg:pb-12 lg:pt-8">
        <aside aria-label="Bộ lọc khảo sát" className="hidden lg:block">
          <FilterPanel idPrefix="sidebar" filters={filters} onChange={(patch) => setFilters(patch)} />
        </aside>

        <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
          {activation.kind === "banner" ? <ActivationBanner view={activation} /> : null}
          {activation.kind === "expiring" ? (
            <StarterExpiringSection
              view={activation}
              quickSurveys={quickestSurveys(openSurveys)}
              pendingId={pendingId}
              onStart={start}
            />
          ) : null}

          {showEmptyState ? (
            <MarketplaceEmptyState availablePoints={balance?.available ?? null} />
          ) : (
            <>
              <MarketplaceToolbar filters={filters} setFilters={setFilters} resetFilters={resetFilters} />

              {notice ? (
                <Alert tone={notice.tone} onDismiss={dismissNotice}>
                  {notice.message}
                </Alert>
              ) : null}

              {feed.error && !profileRequired ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <Alert tone="danger" className="flex-1">
                    {feedErrorMessage(feed.error)}
                  </Alert>
                  <Button variant="secondary" size="md" radius="field" onClick={feed.reload}>
                    {MARKETPLACE_MESSAGES.retry}
                  </Button>
                </div>
              ) : null}

              {surveys === undefined && !feed.error ? (
                <div role="status" aria-label="Đang tải khảo sát" className="grid gap-4 lg:grid-cols-2 lg:gap-5 xl:grid-cols-3">
                  {Array.from({ length: SKELETON_COUNT }, (_, index) => (
                    <SurveyCardSkeleton key={index} />
                  ))}
                </div>
              ) : null}

              {showNoMatch ? <NoMatchState onReset={resetFilters} /> : null}

              {surveys && surveys.length > 0 ? (
                <ul aria-busy={feed.loading || undefined} className="grid gap-4 lg:grid-cols-2 lg:gap-5 xl:grid-cols-3">
                  {surveys.map((survey) => (
                    <li key={survey.id} className="flex flex-col [&>article]:flex-1">
                      <SurveyCard
                        survey={survey}
                        featured={survey.id === featuredId}
                        starting={pendingId === survey.id}
                        disabled={pendingId !== null && pendingId !== survey.id}
                        onStart={start}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}
