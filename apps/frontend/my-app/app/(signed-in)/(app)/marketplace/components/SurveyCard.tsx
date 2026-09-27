import { buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Spinner } from "@/components/ui/Spinner";
import { Tag } from "@/components/ui/Tag";
import type { MarketplaceCard } from "@/lib/marketplace/marketplace-service";
import { effortMinutes, remainingSlots } from "@/lib/marketplace/marketplace-query";

/** "+12 điểm" pill — 30px on cards, 28px in the 15f quick list. */
export function RewardPill({ points, size = "md" }: { points: number; size?: "sm" | "md" }) {
  return (
    <span
      className={[
        "inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-tone-amber-bg px-2.5 font-extrabold text-tone-amber-fg",
        size === "md" ? "h-7.5 text-[14px]" : "h-7 text-[13px]",
      ].join(" ")}
    >
      +{points} điểm
    </span>
  );
}

export const SURVEY_TYPE_LABELS = { INTERNAL: "Trong Rescom", EXTERNAL: "Google Forms" } as const;

interface SurveyCardProps {
  survey: MarketplaceCard;
  /** Figma: the first card's "Bắt đầu" is the filled primary button, the others outlined. */
  featured: boolean;
  starting: boolean;
  /** Another card is starting. */
  disabled: boolean;
  onStart: (survey: MarketplaceCard) => void;
}

/** Figma 3 survey card — desktop 62:659 (337 × 242), mobile 62:1310 (350 wide). */
export function SurveyCard({ survey, featured, starting, disabled, onStart }: SurveyCardProps) {
  const completed = survey.isCompletedByCurrentUser;
  const minutes = effortMinutes(survey.estimatedEffortSeconds);
  const titleId = `survey-${survey.id}-title`;

  return (
    <article
      aria-labelledby={titleId}
      className={[
        "flex flex-col rounded-[18px] border border-line p-4 lg:rounded-[20px] lg:p-5",
        completed ? "bg-surface-subtle" : "bg-surface",
      ].join(" ")}
    >
      <div className="flex min-h-7.5 items-center gap-2">
        {completed ? (
          <Tag tone="teal" icon={<Icon name="check" size={14} />}>
            Đã hoàn thành
          </Tag>
        ) : (
          <Tag tone={survey.type === "INTERNAL" ? "teal" : "blue"}>{SURVEY_TYPE_LABELS[survey.type]}</Tag>
        )}
        {!completed && survey.hasTargeting ? (
          // Mobile only in Figma (62:1313).
          <span className="text-[12px] font-semibold text-ink-muted lg:hidden">Phù hợp với bạn</span>
        ) : null}
        {!completed ? (
          <span className="ml-auto">
            <RewardPill points={survey.rewardPerResponse} />
          </span>
        ) : null}
      </div>

      <h3
        id={titleId}
        className={[
          "mt-[11px] text-[16px] font-bold leading-[21.6px] lg:mt-[13px] lg:line-clamp-2 lg:min-h-[46px] lg:text-[17px] lg:leading-[23px]",
          completed ? "text-ink-muted" : "text-ink",
        ].join(" ")}
      >
        {survey.title}
      </h3>

      <p
        className={[
          "mt-3 flex-wrap items-center gap-x-3 gap-y-1 text-caption text-ink-muted lg:mt-3.5",
          // The mobile completed card (62:1353) shows the title only.
          completed ? "hidden lg:flex" : "flex",
        ].join(" ")}
      >
        <span className="inline-flex items-center gap-1">
          <span className="lg:hidden">
            <Icon name="clock" size={16} />
          </span>
          {minutes} phút
        </span>
        {!completed ? (
          <span>
            Còn {remainingSlots(survey)}/{survey.expectedCompletions} suất
          </span>
        ) : null}
        {survey.topic ? <span>{survey.topic}</span> : null}
      </p>

      {!completed ? (
        <>
          <ProgressBar
            value={survey.completedCompletions}
            max={survey.expectedCompletions}
            height={6}
            tone="brand"
            className="mt-3.5 hidden lg:block"
          />
          <button
            type="button"
            onClick={() => onStart(survey)}
            disabled={disabled || starting}
            aria-busy={starting || undefined}
            aria-label={`Bắt đầu: ${survey.title}`}
            className={buttonClassName({
              variant: featured ? "primary" : "outline",
              size: "md",
              radius: "field",
              fullWidth: true,
              className: "mt-3 lg:mt-3.5",
            })}
          >
            {starting ? <Spinner /> : null}
            <span>{starting ? "Đang mở…" : "Bắt đầu"}</span>
          </button>
        </>
      ) : null}
    </article>
  );
}

/** Loading placeholder with the card's footprint. */
export function SurveyCardSkeleton() {
  return (
    <div aria-hidden className="flex animate-pulse flex-col rounded-[18px] border border-line bg-surface p-4 lg:rounded-[20px] lg:p-5">
      <div className="flex items-center justify-between">
        <span className="h-6.5 w-26 rounded-full bg-surface-subtle" />
        <span className="h-7.5 w-20 rounded-full bg-surface-subtle" />
      </div>
      <span className="mt-4 h-5 w-11/12 rounded-md bg-surface-subtle" />
      <span className="mt-2 h-5 w-2/3 rounded-md bg-surface-subtle" />
      <span className="mt-4 h-4 w-1/2 rounded-md bg-surface-subtle" />
      <span className="mt-4 hidden h-1.5 w-full rounded-full bg-surface-subtle lg:block" />
      <span className="mt-3.5 h-11 w-full rounded-field bg-surface-subtle" />
    </div>
  );
}
