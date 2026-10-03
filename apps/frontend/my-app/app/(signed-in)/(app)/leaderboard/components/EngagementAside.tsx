import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { EngagementSummary } from "@/lib/engagement/engagement-service";
import { formatDays } from "@/lib/engagement/streak-view";
import { nextTierProgress } from "@/lib/engagement/tiers";
import { TierNote } from "../../_engagement/TierNote";
import { TierTimeline } from "../../_engagement/TierTimeline";

/**
 * Desktop right column of 16b (63:3233–63:3270): "Chuỗi của bạn", the compact
 * "Hạng thành viên" timeline and the tier note. The streak card and the tier
 * heading link to /account/streak and /account/tier (ASSUMED (design) — not drawn).
 */
export function EngagementAside({ summary }: { summary: EngagementSummary }) {
  const progress = nextTierProgress(summary.tier.level, summary.stats.completedSurveys);
  return (
    <>
      <Link
        href="/account/streak"
        className="flex h-[111px] items-center gap-4 rounded-[20px] bg-tone-amber-bg px-5 transition-[filter] hover:brightness-[0.98]"
      >
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-rating text-ink">
          <Icon name="flame" size={28} />
        </span>
        <span className="min-w-0">
          <span className="block text-caption font-bold text-tone-amber-fg">Chuỗi của bạn</span>
          <span className="block text-[28px] font-extrabold text-ink">{formatDays(summary.streak.current)}</span>
          <span className="block text-caption text-tone-amber-ink">Làm 1 khảo sát mỗi ngày để giữ chuỗi</span>
        </span>
      </Link>

      <section aria-labelledby="tier-card-title" className="rounded-[20px] border border-line bg-surface px-[17px] pt-4 pb-[18px]">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="tier-card-title" className="text-[16px] font-extrabold text-ink">
            <Link href="/account/tier" className="hover:underline">
              Hạng thành viên
            </Link>
          </h2>
          {progress ? (
            <p className="text-caption text-ink-muted">
              {progress.current}/{progress.target} đến hạng tiếp theo
            </p>
          ) : null}
        </div>
        <TierTimeline currentLevel={summary.tier.level} variant="compact" className="mt-3" />
      </section>

      <TierNote />
    </>
  );
}
