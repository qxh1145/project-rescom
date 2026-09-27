"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AppHeader } from "@/components/layout/app/AppHeader";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import type { WizardStep } from "@/lib/forms/create-wizard";

const STEP_LABELS: Record<WizardStep, { desktop: string; mobile: string }> = {
  1: { desktop: "Thông tin", mobile: "Thông tin khảo sát" },
  2: { desktop: "Đối tượng", mobile: "Đối tượng" },
  3: { desktop: "Số mẫu & điểm", mobile: "Số mẫu & điểm thưởng" },
};

const BACK_LABELS: Record<WizardStep, string> = {
  1: "Quay lại chọn cách tạo",
  2: "Quay lại bước 1",
  3: "Quay lại bước 2",
};

interface WizardFrameProps {
  step: WizardStep;
  onBack: () => void;
  /** Desktop card title (Figma 9a/9b/9c). */
  title: string;
  /** Desktop line under the title (9b). */
  subtitle?: string;
  /** Right column on desktop (hidden on mobile). */
  aside: ReactNode;
  /** Desktop buttons at the bottom of the card. */
  desktopActions: ReactNode;
  /** Mobile sticky bottom bar (white, top border). */
  mobileActions: ReactNode;
  children: ReactNode;
}

/**
 * Google Forms wizard chrome (Figma 9a–9c). Desktop (≥ lg): the app header,
 * the form card (828px) with breadcrumb, title and numbered stepper, and a
 * 340px side column. Mobile: back header with "Bước n/3" and a 3-segment
 * progress bar, the fields, and a sticky action bar — no bottom nav, which is
 * why the route lives in the `(focus)` group and renders `AppHeader` itself.
 */
export function WizardFrame({
  step,
  onBack,
  title,
  subtitle,
  aside,
  desktopActions,
  mobileActions,
  children,
}: WizardFrameProps) {
  return (
    <>
      <AppHeader />
      <header className="sticky top-0 z-30 bg-surface pt-[max(env(safe-area-inset-top),8px)] lg:hidden">
        <div className="flex min-h-15 items-center gap-3 px-5">
          <IconButton icon="chevron-left" label={BACK_LABELS[step]} onClick={onBack} />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold text-ink">Tạo khảo sát Google Forms</p>
            <p className="truncate text-[12px] text-ink-muted">
              Bước {step}/3 · {STEP_LABELS[step].mobile}
            </p>
          </div>
        </div>
        <div className="flex gap-1.5 px-5 pt-3.5 pb-4" aria-hidden="true">
          {([1, 2, 3] as const).map((item) => (
            <span key={item} className={`h-1.5 flex-1 rounded-[3px] ${item <= step ? "bg-primary" : "bg-line"}`} />
          ))}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-300 flex-1 flex-col gap-8 lg:flex-row lg:items-start lg:px-6 lg:py-8">
        <section
          aria-labelledby="wizard-title"
          className="flex flex-1 flex-col lg:min-w-0 lg:rounded-card lg:border lg:border-line lg:bg-surface lg:px-10 lg:pt-8 lg:pb-9"
        >
          <nav aria-label="Vị trí" className="hidden text-caption lg:block">
            <Link href="/forms" className="font-semibold text-primary hover:underline">
              Khảo sát của tôi
            </Link>
            <span className="text-ink-muted"> / Tạo khảo sát</span>
          </nav>
          <h1 id="wizard-title" className="sr-only lg:not-sr-only lg:mt-1.5 lg:text-[28px] lg:font-extrabold lg:tracking-[-0.3px] lg:text-ink">
            {title}
          </h1>
          {subtitle ? <p className="hidden text-body text-ink-muted lg:mt-2 lg:block">{subtitle}</p> : null}
          <DesktopStepper step={step} />

          <div className="flex flex-1 flex-col px-5 pt-5 pb-8 lg:p-0 lg:pt-6">{children}</div>

          <div className="hidden justify-end gap-3 pt-7 lg:flex">{desktopActions}</div>
        </section>

        <aside className="hidden w-85 shrink-0 flex-col gap-4 lg:flex">{aside}</aside>
      </main>

      <div className="sticky bottom-0 z-20 flex gap-3 border-t border-line bg-surface px-5 pt-3.5 pb-[max(env(safe-area-inset-bottom),20px)] lg:hidden">
        {mobileActions}
      </div>
    </>
  );
}

function DesktopStepper({ step }: { step: WizardStep }) {
  return (
    <ol className="mt-6 hidden items-center gap-3 lg:flex" aria-label="Các bước">
      {([1, 2, 3] as const).map((item) => {
        const done = item < step;
        const current = item === step;
        return (
          <li key={item} className={`flex items-center gap-3 ${item < 3 ? "flex-1" : ""}`} aria-current={current ? "step" : undefined}>
            <span
              className={[
                "flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold",
                done ? "bg-step-done text-primary-foreground" : current ? "bg-primary text-primary-foreground" : "bg-line text-ink-muted",
              ].join(" ")}
            >
              {done ? <Icon name="check" size={14} /> : item}
            </span>
            <span
              className={`whitespace-nowrap text-label ${
                current ? "font-bold text-primary-strong" : done ? "font-semibold text-tone-teal-fg" : "font-semibold text-ink-muted"
              }`}
            >
              {STEP_LABELS[item].desktop}
              {done ? <span className="sr-only"> (đã xong)</span> : null}
            </span>
            {item < 3 ? <span aria-hidden="true" className={`h-0.5 flex-1 ${done ? "bg-step-done" : "bg-line"}`} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Trailing arrow inside a primary button ("Tiếp tục →"). */
export function ArrowLabel({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-3">
      {children}
      <Icon name="arrow-right" size={20} />
    </span>
  );
}
