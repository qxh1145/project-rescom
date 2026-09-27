"use client";

import { RescomLogo } from "@/components/brand/RescomLogo";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { ProgressBar } from "@/components/ui/ProgressBar";
import type { SurveyPageSection } from "@/lib/participation/survey-form";

interface ProgressProps {
  answeredUpTo: number;
  total: number;
}

/** Figma 62:159 — logo, progress "4/8 câu", "Lưu và thoát". */
export function DesktopSurveyHeader({ answeredUpTo, total, onSaveAndExit }: ProgressProps & { onSaveAndExit: () => void }) {
  return (
    <header className="sticky top-0 z-30 hidden h-18.25 items-center gap-6 border-b border-line bg-surface px-12 lg:flex">
      <RescomLogo size="md" />
      <div className="flex flex-1 items-center justify-center gap-3">
        <ProgressBar
          value={answeredUpTo}
          max={total}
          height={8}
          className="max-w-[453px]"
          label={`Tiến độ khảo sát: ${answeredUpTo}/${total} câu`}
        />
        <span className="shrink-0 text-label font-semibold text-ink-muted">
          {answeredUpTo}/{total} câu
        </span>
      </div>
      <button
        type="button"
        onClick={onSaveAndExit}
        className="h-10.5 shrink-0 rounded-[10px] border border-line-strong bg-surface px-4 text-label font-semibold text-ink transition-colors hover:border-ink-muted hover:bg-surface-subtle"
      >
        Lưu và thoát
      </button>
    </header>
  );
}

/** Figma 62:733 — exit (X), title, "Câu 3 – 4 / 8", "+12" pill, progress. */
export function MobileSurveyHeader({
  title,
  rangeLabel,
  reward,
  answeredUpTo,
  total,
  onSaveAndExit,
}: ProgressProps & { title: string; rangeLabel: string; reward: number; onSaveAndExit: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface pt-[max(env(safe-area-inset-top),8px)] lg:hidden">
      <div className="flex items-center gap-3 px-5">
        <IconButton icon="x" label="Lưu và thoát khảo sát" onClick={onSaveAndExit} />
        <div className="mr-auto min-w-0">
          <p className="truncate text-body font-bold text-ink">{title}</p>
          <p className="text-[12px] text-ink-muted">{rangeLabel}</p>
        </div>
        <span className="inline-flex h-7.5 shrink-0 items-center rounded-full bg-tone-amber-bg px-2.5 text-caption font-extrabold text-tone-amber-fg">
          +{reward}
        </span>
      </div>
      <div className="px-5 pt-3.5 pb-4">
        <ProgressBar value={answeredUpTo} max={total} height={8} label={`Tiến độ khảo sát: ${rangeLabel}`} />
      </div>
    </header>
  );
}

/** Figma 62:203 "Phần thưởng" card. */
export function RewardCard({ reward, effort, publisher }: { reward: number; effort: string; publisher: string }) {
  return (
    <section aria-label="Phần thưởng" className="flex flex-col gap-4 rounded-[20px] border border-line bg-surface px-5 pt-5 pb-[22px]">
      <div className="flex items-center justify-between">
        <span className="text-label font-semibold text-ink-muted">Phần thưởng</span>
        <span className="inline-flex h-8 items-center rounded-full bg-tone-amber-bg px-3 text-body font-extrabold text-tone-amber-fg">
          +{reward} điểm
        </span>
      </div>
      <dl className="flex flex-col gap-[15px] text-label">
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">Thời lượng ước tính</dt>
          <dd className="font-bold text-ink">{effort}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-ink-muted">Người đăng</dt>
          <dd className="truncate font-bold text-ink">{publisher}</dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * Figma 62:211 "Nav – Các phần": done = teal check, current = green pill
 * with a ring, upcoming = grey ring. Finished sections can be revisited.
 */
export function SectionNav({
  sections,
  currentIndex,
  furthestIndex,
  onJump,
}: {
  sections: SurveyPageSection[];
  currentIndex: number;
  /** Highest section reached so far; earlier ones count as done. */
  furthestIndex: number;
  onJump: (sectionIndex: number) => void;
}) {
  return (
    <nav aria-label="Các phần" className="rounded-[20px] border border-line bg-surface p-3">
      <ol className="flex flex-col gap-1">
        {sections.map((section, index) => {
          const current = index === currentIndex;
          const done = !current && index <= furthestIndex;
          const label = `${section.number} · ${section.title}`;
          if (current) {
            return (
              <li key={section.id} aria-current="step" className="flex h-11 items-center gap-2.5 rounded-[10px] bg-tone-green-bg px-3">
                <span className="size-4.5 shrink-0 rounded-full border-2 border-primary" aria-hidden="true" />
                <span className="text-label font-bold text-primary-strong">{label}</span>
              </li>
            );
          }
          if (done) {
            return (
              <li key={section.id}>
                <button
                  type="button"
                  onClick={() => onJump(index)}
                  className="flex h-11 w-full items-center gap-2.5 rounded-[10px] px-3 text-left transition-colors hover:bg-surface-subtle"
                >
                  <Icon name="check" size={18} className="text-tone-teal-fg" />
                  <span className="text-label font-semibold text-tone-teal-fg">{label}</span>
                  <span className="sr-only">(đã xong, mở lại)</span>
                </button>
              </li>
            );
          }
          return (
            <li key={section.id} className="flex h-11 items-center gap-2.5 px-3">
              <span className="size-4.5 shrink-0 rounded-full border-2 border-line-strong" aria-hidden="true" />
              <span className="text-label text-ink-muted">{label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Figma 62:220 / 62:772 — the time-barrier reminder. */
export function PaceNotice({ variant }: { variant: "desktop" | "mobile" }) {
  return (
    <p className="flex gap-2.5 rounded-2xl bg-tone-green-bg px-3.5 py-3.5 text-caption leading-[19.5px] text-ink lg:py-[13px]">
      <Icon name="clock" size={20} className="shrink-0 text-primary" />
      <span>
        {variant === "desktop"
          ? "Bài nộp quá nhanh so với thời lượng ước tính sẽ không được tính điểm."
          : "Hãy đọc kỹ từng câu. Bài nộp quá nhanh so với thời lượng ước tính sẽ không được tính."}
      </span>
    </p>
  );
}
