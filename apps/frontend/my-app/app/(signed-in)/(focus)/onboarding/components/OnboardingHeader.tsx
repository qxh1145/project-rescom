import { RescomLogo } from "@/components/brand/RescomLogo";
import { Icon } from "@/components/ui/Icon";
import { ONBOARDING_PARTS } from "@/lib/onboarding/onboarding-steps";

interface OnboardingHeaderProps {
  /**
   * 0-based current part; `ONBOARDING_PARTS.length` = every part done
   * (Hoàn tất). Omit for the welcome screen, which shows the logo only.
   */
  activePart?: number;
}

/** Desktop header of page 12 (63:2367): logo + "1 Về bạn — 2 Học tập & công việc — …". */
export function OnboardingHeader({ activePart }: OnboardingHeaderProps) {
  return (
    <header className="hidden h-18.25 shrink-0 items-center justify-between border-b border-line bg-surface px-12 lg:flex">
      <RescomLogo size="md" highPriority />
      {activePart === undefined ? null : (
        <ol aria-label="Các phần của hồ sơ" className="flex items-center">
          {ONBOARDING_PARTS.map((part, index) => {
            const done = index < activePart;
            const current = index === activePart;
            return (
              <li key={part} className="flex items-center gap-2" aria-current={current ? "step" : undefined}>
                {index > 0 ? (
                  <span aria-hidden="true" className={`mr-0.5 ml-2.5 h-0.5 w-8 ${index <= activePart ? "bg-primary" : "bg-line"}`} />
                ) : null}
                  <span
                    aria-hidden="true"
                    className={`flex size-6.5 items-center justify-center rounded-full text-[13px] font-extrabold ${
                      done || current ? "bg-primary text-primary-foreground" : "bg-line text-ink-muted"
                    }`}
                  >
                    {done ? <Icon name="check" size={14} /> : index + 1}
                  </span>
                  <span
                    className={`text-label ${
                      current ? "font-bold text-primary-strong" : done ? "font-semibold text-ink" : "font-semibold text-ink-muted"
                    }`}
                  >
                    {part}
                    {done ? <span className="sr-only"> (đã xong)</span> : null}
                  </span>
              </li>
            );
          })}
        </ol>
      )}
    </header>
  );
}
