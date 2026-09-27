"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { useApiQuery } from "@/lib/api/use-api-query";
import { ENGAGEMENT_MESSAGES } from "@/lib/engagement/engagement-messages";
import { getEngagementSummary } from "@/lib/engagement/engagement-service";
import {
  getLeaderboard,
  LEADERBOARD_PERIODS,
  LEADERBOARD_TYPES,
  type LeaderboardPeriod,
  type LeaderboardType,
} from "@/lib/engagement/leaderboard-service";
import {
  LEADERBOARD_PERIOD_LABELS,
  LEADERBOARD_TYPE_LABELS,
  parseLeaderboardParams,
  scopeLabel,
} from "@/lib/engagement/leaderboard-view";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";
import { ErrorStatus, LoadingStatus } from "../../_engagement/QueryStatus";
import { EngagementAside } from "./EngagementAside";
import { LeaderboardRows } from "./LeaderboardRows";

const TYPE_SEGMENTS = LEADERBOARD_TYPES.map((value) => ({ value, label: LEADERBOARD_TYPE_LABELS[value] }));

/** Board and period live in the URL (`?type=streak&period=all`) so 16a can link to the streak board. */
function useLeaderboardParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = useMemo(() => parseLeaderboardParams(searchParams), [searchParams]);
  const setParams = useCallback(
    (patch: Partial<{ type: LeaderboardType; period: LeaderboardPeriod }>) => {
      const next = { ...params, ...patch };
      const query = new URLSearchParams();
      if (next.type !== "surveys") query.set("type", next.type);
      if (next.period !== "week") query.set("period", next.period);
      const search = query.toString();
      router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );
  return { ...params, setParams };
}

/** Period chips "Tuần này" / "Mọi lúc" (63:3140): selected = ink pill, other = outlined. */
function PeriodChips({ period, onChange }: { period: LeaderboardPeriod; onChange: (period: LeaderboardPeriod) => void }) {
  return (
    <div role="group" aria-label="Khoảng thời gian" className="flex gap-2">
      {LEADERBOARD_PERIODS.map((value) => {
        const selected = value === period;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(value)}
            className={[
              "inline-flex h-9 items-center whitespace-nowrap rounded-full px-3.5 text-caption transition-colors",
              selected
                ? "bg-ink font-bold text-primary-foreground"
                : "border border-line-strong bg-surface font-semibold text-ink hover:border-ink-muted hover:bg-surface-subtle",
            ].join(" ")}
          >
            {LEADERBOARD_PERIOD_LABELS[value]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Figma 16b "Bảng xếp hạng" — desktop 63:3114 (900px list + 420px column with
 * streak, tier and note), mobile 63:4078 (list only; the user's row sticks to
 * the bottom). Inside the app shell like /account/trust: mobile back header +
 * bottom nav.
 */
export function LeaderboardScreen() {
  const { type, period, setParams } = useLeaderboardParams();
  const board = useApiQuery(`leaderboard:${type}:${period}`, (signal) => getLeaderboard(type, period, signal));
  const summary = useApiQuery("engagement-summary", getEngagementSummary);
  // 401 / locked account: SessionGate redirects; keep the loading state meanwhile.
  const sessionLost = useSessionLossRedirect(board.error, summary.error);
  const [scopeTop, scopeBottom] = scopeLabel(period, board.data?.size ?? 10);

  return (
    <>
      <MobileBackBar title="Bảng xếp hạng" backHref="/account" />
      <div className="mx-auto w-full max-w-[1440px] lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:items-start lg:gap-6 lg:px-12 lg:pt-8 lg:pb-12">
        <section
          aria-labelledby="leaderboard-title"
          className="bg-surface lg:overflow-hidden lg:rounded-[22px] lg:border lg:border-line"
        >
          <div className="border-b border-line px-4 pt-3.5 pb-[15px] lg:px-6 lg:pt-[19px] lg:pb-5">
            <h1 id="leaderboard-title" className="mb-3.5 hidden text-[24px] font-extrabold text-ink lg:block">
              Bảng xếp hạng
            </h1>
            <SegmentedControl
              segments={TYPE_SEGMENTS}
              value={type}
              onChange={(value) => setParams({ type: value })}
              label="Loại bảng xếp hạng"
              variant="bordered"
              fullWidth
            />
            <div className="mt-3 flex items-start justify-between gap-3 lg:mt-3.5">
              <PeriodChips period={period} onChange={(value) => setParams({ period: value })} />
              <p className="pt-0.5 text-right text-[12px] text-ink-muted">
                {scopeTop}
                <br />
                {scopeBottom}
              </p>
            </div>
          </div>

          {board.error && !board.data && !sessionLost ? (
            <ErrorStatus
              message={ENGAGEMENT_MESSAGES.leaderboardLoadFailed}
              onRetry={board.reload}
              className="m-4 lg:m-6"
            />
          ) : !board.data ? (
            <LoadingStatus className="px-4 lg:px-6" />
          ) : (
            <div aria-busy={board.loading || undefined}>
              <LeaderboardRows board={board.data} emptyMessage={ENGAGEMENT_MESSAGES.leaderboardEmpty} />
            </div>
          )}
        </section>

        <aside aria-label="Chuỗi và hạng của bạn" className="hidden flex-col gap-4 lg:flex">
          {summary.error && !summary.data && !sessionLost ? (
            <ErrorStatus message={ENGAGEMENT_MESSAGES.summaryLoadFailed} onRetry={summary.reload} />
          ) : !summary.data ? (
            <LoadingStatus />
          ) : (
            <EngagementAside summary={summary.data} />
          )}
        </aside>
      </div>
    </>
  );
}
