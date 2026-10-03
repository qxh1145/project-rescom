import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { formatDeadline, type VisibleActivation } from "@/lib/economy/starter-points-service";
import type { MarketplaceCard } from "@/lib/marketplace/marketplace-service";
import { effortMinutes } from "@/lib/marketplace/marketplace-query";
import { RewardPill, SURVEY_TYPE_LABELS } from "./SurveyCard";

interface StarterExpiringSectionProps {
  view: VisibleActivation;
  /** Quickest open surveys, shortest first. */
  quickSurveys: readonly MarketplaceCard[];
  pendingId: string | null;
  onStart: (survey: MarketplaceCard) => void;
}

/**
 * 15f "Điểm khởi đầu sắp hết hạn" — mobile 63:1877 (warning 63:1889 + "Khảo
 * sát nhanh cho bạn"). Desktop is not drawn: ASSUMED (design) same blocks in the
 * content column, CTA auto-width and the quick list as a 3-column grid.
 */
export function StarterExpiringSection({ view, quickSurveys, pendingId, onStart }: StarterExpiringSectionProps) {
  const quickest = quickSurveys[0];
  const busy = pendingId !== null;

  return (
    <>
      <section
        aria-labelledby="starter-expiring-title"
        className="rounded-[20px] border border-tone-amber-strong bg-tone-amber-bg p-4.5"
      >
        <div className="flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-field bg-tone-amber-accent text-ink">
            <Icon name="hourglass" size={22} />
          </span>
          <div className="min-w-0">
            <h2 id="starter-expiring-title" className="text-[18px] font-extrabold leading-[23.4px] text-ink">
              {view.daysRemaining > 0
                ? `Còn ${view.daysRemaining} ngày để giữ ${view.amount} điểm khởi đầu`
                : `Hôm nay là ngày cuối để giữ ${view.amount} điểm khởi đầu`}
            </h2>
            <p className="mt-1 text-body-sm text-tone-amber-ink">
              Làm 1 khảo sát trước hết ngày {formatDeadline(view.expiresAt)} để mở khoá. Sau thời hạn này, {view.amount} điểm
              đóng băng sẽ mất.
            </p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between text-caption font-bold text-tone-amber-ink">
          <span>{view.profileComplete ? "Hồ sơ ✓" : "Hồ sơ chưa xong"}</span>
          {/* The expiring variant only shows while the first survey is still missing. */}
          <span>Còn 1 khảo sát</span>
        </div>
        <div
          role="progressbar"
          aria-label="Tiến độ kích hoạt tài khoản"
          aria-valuemin={0}
          aria-valuemax={view.totalSteps}
          aria-valuenow={view.completedSteps}
          className="mt-1.5 h-2 overflow-hidden rounded-full bg-tone-amber-track"
        >
          <div
            className="h-full rounded-full bg-tone-amber-strong"
            style={{ width: `${(view.completedSteps / view.totalSteps) * 100}%` }}
          />
        </div>

        {quickest ? (
          <Button
            size="lg"
            radius="field"
            fullWidth
            className="mt-3 lg:w-auto lg:px-8"
            loading={pendingId === quickest.id}
            disabled={busy}
            onClick={() => onStart(quickest)}
          >
            Làm khảo sát {effortMinutes(quickest.estimatedEffortSeconds)} phút ngay
          </Button>
        ) : null}
      </section>

      {quickSurveys.length > 0 ? (
        <section aria-labelledby="quick-surveys-title">
          <h2 id="quick-surveys-title" className="text-[16px] font-extrabold text-ink">
            Khảo sát nhanh cho bạn
          </h2>
          <ul className="mt-3.5 grid gap-3.5 lg:grid-cols-3 lg:gap-5">
            {quickSurveys.map((survey) => (
              <li key={survey.id}>
                <button
                  type="button"
                  onClick={() => onStart(survey)}
                  disabled={busy}
                  aria-busy={pendingId === survey.id || undefined}
                  className="flex w-full items-center gap-3 rounded-[16px] border border-line bg-surface px-4 py-3.5 text-left transition-colors enabled:hover:border-line-strong disabled:cursor-not-allowed"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-body font-bold leading-[20.3px] text-ink">{survey.title}</span>
                    <span className="mt-1.5 block text-caption text-ink-muted">
                      {SURVEY_TYPE_LABELS[survey.type]} · {effortMinutes(survey.estimatedEffortSeconds)} phút
                    </span>
                  </span>
                  <RewardPill points={survey.rewardPerResponse} size="sm" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
