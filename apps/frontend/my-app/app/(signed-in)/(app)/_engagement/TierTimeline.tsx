import { Icon } from "@/components/ui/Icon";
import { TIERS } from "@/lib/engagement/tiers";

interface TierTimelineProps {
  /** The user's tier level (1…5). */
  currentLevel: number;
  /**
   * `detailed` = 16 "Hạng thành viên" (63:4995) with each tier's perk;
   * `compact` = the 16b desktop card (63:3240): name + requirement only.
   */
  variant?: "detailed" | "compact";
  className?: string;
}

function StepCircle({ level, currentLevel }: { level: number; currentLevel: number }) {
  if (level < currentLevel) {
    return (
      <span className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Icon name="check-bold" size={16} label="Đã đạt" />
      </span>
    );
  }
  if (level === currentLevel) {
    return (
      <span className="flex size-8 items-center justify-center rounded-full border-3 border-primary bg-tone-green-bg text-caption font-extrabold text-tone-green-fg">
        {level}
      </span>
    );
  }
  return (
    <span className="flex size-8 items-center justify-center rounded-full border-2 border-line bg-surface text-caption font-extrabold text-ink-muted">
      {level}
    </span>
  );
}

/**
 * Vertical tier timeline (Figma 16 / 16b): done tiers = green disc + check,
 * the current one = ringed number + "Bạn ở đây", later ones = grey ring. The
 * connector under a tier is green once the next tier is reached.
 */
export function TierTimeline({ currentLevel, variant = "detailed", className = "" }: TierTimelineProps) {
  const detailed = variant === "detailed";
  return (
    <ol className={`flex flex-col ${className}`}>
      {TIERS.map((tier, index) => {
        const isCurrent = tier.level === currentLevel;
        const isLast = index === TIERS.length - 1;
        return (
          <li key={tier.level} aria-current={isCurrent ? "step" : undefined} className="flex gap-3.5">
            <div className="flex w-8 shrink-0 flex-col items-center">
              <StepCircle level={tier.level} currentLevel={currentLevel} />
              {isLast ? null : (
                <span
                  aria-hidden
                  className={`-mb-1 mt-0.5 w-0.5 flex-1 ${tier.level < currentLevel ? "bg-primary" : "bg-line"}`}
                />
              )}
            </div>
            <div className={`min-w-0 flex-1 ${isLast ? "" : detailed ? "pb-5" : "pb-3.5"}`}>
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={`text-body font-extrabold ${tier.level > currentLevel ? "text-ink-strong" : "text-ink"}`}>
                  {tier.name}
                </span>
                {isCurrent ? (
                  <span className="inline-flex h-5.5 items-center rounded-full bg-primary px-2 text-[11px] font-extrabold text-primary-foreground">
                    Bạn ở đây
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-caption font-semibold text-ink-muted">{tier.requirement}</p>
              {detailed ? <p className="text-caption leading-[18.9px] text-ink-strong">{tier.perk}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
