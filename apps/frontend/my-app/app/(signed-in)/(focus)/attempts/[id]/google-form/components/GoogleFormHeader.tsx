import Link from "next/link";
import { RescomLogo } from "@/components/brand/RescomLogo";
import { MobileBackBar } from "@/components/layout/app/MobileTopBar";

interface GoogleFormHeaderProps {
  title: string;
  /** "Google Forms · 8 phút". */
  subtitle: string;
  /** Mobile reward pill ("+18"); hidden on the locked screen (62:67). */
  reward?: number;
  /** Desktop "Huỷ lượt làm" (62:5); omitted when the attempt is no longer in progress. */
  onCancel?: () => void;
}

/**
 * Desktop header (62:3): logo + "Huỷ lượt làm". Mobile header (62:360):
 * back link, survey title + "Google Forms · 8 phút", reward pill.
 */
export function GoogleFormHeader({ title, subtitle, reward, onCancel }: GoogleFormHeaderProps) {
  return (
    <>
      <header className="hidden h-18.25 shrink-0 items-center justify-between border-b border-line bg-surface px-12 lg:flex">
        <Link href="/marketplace" aria-label="Rescom: Khám phá">
          <RescomLogo size="md" highPriority />
        </Link>
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="h-10.5 rounded-[10px] border border-line-strong bg-surface px-4 text-label font-semibold text-ink transition-colors hover:bg-surface-subtle"
          >
            Huỷ lượt làm
          </button>
        ) : null}
      </header>
      <MobileBackBar
        title={title}
        subtitle={subtitle}
        backHref="/marketplace"
        action={
          reward !== undefined ? (
            <span className="inline-flex h-7.5 shrink-0 items-center rounded-full bg-tone-amber-bg px-2.5 text-[13px] font-extrabold text-tone-amber-fg">
              +{reward}
              <span className="sr-only"> điểm</span>
            </span>
          ) : undefined
        }
      />
    </>
  );
}
