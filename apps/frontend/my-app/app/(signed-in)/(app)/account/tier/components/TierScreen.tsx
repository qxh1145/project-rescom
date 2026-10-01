"use client";

import Link from "next/link";
import { DemoDataTag } from "@/components/ui/DemoDataTag";
import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { buttonClassName } from "@/components/ui/Button";
import { useApiQuery } from "@/lib/api/use-api-query";
import { ENGAGEMENT_MESSAGES } from "@/lib/engagement/engagement-messages";
import { getEngagementSummary, type EngagementSummary } from "@/lib/engagement/engagement-service";
import { nextTierProgress, tierOf } from "@/lib/engagement/tiers";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";
import { ErrorStatus, LoadingStatus } from "../../../_engagement/QueryStatus";
import { TierNote } from "../../../_engagement/TierNote";
import { TierTimeline } from "../../../_engagement/TierTimeline";

/** "Section" 63:4987: current tier on primary, yellow-on-green progress to the next tier. */
function CurrentTierCard({ summary }: { summary: EngagementSummary }) {
  const tier = tierOf(summary.tier.level);
  const progress = nextTierProgress(summary.tier.level, summary.stats.completedSurveys);
  return (
    <section
      aria-labelledby="current-tier-name"
      className="rounded-[22px] bg-primary px-5 pt-[19px] pb-[19px] text-primary-foreground"
    >
      <p className="text-caption font-bold tracking-[0.5px]">HẠNG HIỆN TẠI</p>
      <h2 id="current-tier-name" className="mt-[11px] text-[24px] font-extrabold">
        {tier.name}
      </h2>
      {progress ? (
        <>
          <p className="mt-3 flex items-baseline justify-between gap-3 text-body-sm leading-normal">
            <span>Đến {progress.next.name}</span>
            <span className="font-bold">
              {progress.current}/{progress.target}
            </span>
          </p>
          <div
            role="progressbar"
            aria-label={`Tiến độ lên ${progress.next.name}`}
            aria-valuemin={0}
            aria-valuemax={progress.target}
            aria-valuenow={progress.current}
            aria-valuetext={`${progress.current}/${progress.target} khảo sát`}
            className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-activation-track"
          >
            <div
              className="h-full rounded-full bg-tone-amber-accent"
              style={{ width: `${(progress.current / progress.target) * 100}%` }}
            />
          </div>
          <p className="mt-1.5 text-caption">
            {/* Level 1 → 2 also needs the profile (ASSUMED copy); otherwise Figma "Còn 18 khảo sát nữa." */}
            {summary.tier.level === 1
              ? `${progress.next.requirement}.`
              : progress.remaining > 0
                ? `Còn ${progress.remaining} khảo sát nữa.`
                : "Đã đủ khảo sát, hạng sẽ được cập nhật sớm."}
          </p>
        </>
      ) : (
        // ASSUMED (not drawn): top tier.
        <p className="mt-3 text-body-sm leading-normal">Bạn đang ở hạng cao nhất.</p>
      )}
    </section>
  );
}

/**
 * Figma 16 "Hạng thành viên" (63:4981, mobile). Desktop is derived (ASSUMED):
 * the same cards in a 720px column under the app header.
 */
export function TierScreen() {
  const query = useApiQuery("engagement-summary", getEngagementSummary);
  const summary = query.data;
  // 401 / locked account: SessionGate redirects; keep the loading state meanwhile.
  const sessionLost = useSessionLossRedirect(query.error);

  return (
    <>
      <MobileBackBar title="Hạng thành viên" backHref="/account" />
      <div className="mx-auto flex w-full max-w-[720px] flex-col px-4 pt-[18px] pb-8 lg:px-0 lg:pt-10 lg:pb-12">
        <h1 className="mb-6 hidden text-title font-extrabold text-ink lg:block">Hạng thành viên</h1>
        <DemoDataTag className="mb-4 self-start" />

        {query.error && !summary && !sessionLost ? (
          <ErrorStatus message={ENGAGEMENT_MESSAGES.summaryLoadFailed} onRetry={query.reload} />
        ) : !summary ? (
          <LoadingStatus />
        ) : (
          <div className="flex flex-col gap-4">
            <CurrentTierCard summary={summary} />
            <section aria-label="Các hạng thành viên" className="rounded-[20px] border border-line bg-surface px-[17px] pt-[17px] pb-6">
              <TierTimeline currentLevel={summary.tier.level} />
            </section>
            <TierNote />
            <Link href="/marketplace" className={buttonClassName({ size: "lg", radius: "field", fullWidth: true })}>
              Tìm khảo sát để làm
            </Link>
          </div>
        )}
      </div>
    </>
  );
}
