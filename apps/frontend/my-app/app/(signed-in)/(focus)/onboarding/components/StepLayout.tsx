"use client";

import { useEffect, useRef, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { ONBOARDING_PARTS, type StepPosition } from "@/lib/onboarding/onboarding-steps";
import { OnboardingHeader } from "./OnboardingHeader";

export interface StepHint {
  text: string;
  tone?: "muted" | "danger";
}

interface StepLayoutProps {
  /** Changes per screen: moves focus to the new question. */
  stepKey: string;
  position: StepPosition;
  title: string;
  /** `id` of the `<h1>`; answer groups use it as their accessible name. */
  titleId: string;
  helper?: string;
  error?: string | null;
  onBack: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  submitting?: boolean;
  /** Replaces "Nhấn Enter để tiếp tục" (desktop) and sits above the button on mobile (12.10 counter). */
  hint?: StepHint;
  children: ReactNode;
}

export function errorIdFor(titleId: string): string {
  return `${titleId}-error`;
}

/** Mobile header (63:2450–63:2459): back button, "Phần 1/4 · Về bạn", "Câu 1/4", 4 part bars. */
function MobileProgress({ position, onBack }: { position: StepPosition; onBack: () => void }) {
  const { partIndex, questionNumber, questionCount } = position;
  return (
    <div className="flex items-start gap-3.5 px-5 pt-[max(env(safe-area-inset-top),8px)] lg:hidden">
      <IconButton icon="chevron-left" label="Quay lại câu trước" onClick={onBack} />
      <div className="min-w-0 flex-1 pt-1.5">
        <div className="flex items-baseline justify-between gap-3 text-caption">
          <p className="truncate font-bold text-primary-strong">
            Phần {partIndex + 1}/{ONBOARDING_PARTS.length} · {ONBOARDING_PARTS[partIndex]}
          </p>
          <p className="shrink-0 font-semibold text-ink-muted">
            Câu {questionNumber}/{questionCount}
          </p>
        </div>
        <div aria-hidden="true" className="mt-2.5 flex gap-1">
          {ONBOARDING_PARTS.map((part, index) => {
            const fill = index < partIndex ? 1 : index === partIndex ? questionNumber / questionCount : 0;
            return (
              <span key={part} className="h-1.5 flex-1 overflow-hidden rounded-[3px] bg-line">
                <span className="block h-full rounded-[3px] bg-primary" style={{ width: `${fill * 100}%` }} />
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * One question per screen (Figma page 12): desktop = header stepper + 738px
 * card (63:2384), mobile = back/progress header + sticky "Tiếp tục" (63:2449).
 * The form submits on Enter ("Nhấn Enter để tiếp tục").
 */
export function StepLayout({
  stepKey,
  position,
  title,
  titleId,
  helper,
  error,
  onBack,
  onSubmit,
  submitLabel = "Tiếp tục",
  submitting = false,
  hint,
  children,
}: StepLayoutProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [stepKey]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  const { partIndex, questionNumber, questionCount } = position;
  const hintClass =
    hint?.tone === "danger" ? "text-label font-semibold text-danger" : "text-caption text-ink-muted";

  return (
    <div className="flex min-h-dvh flex-col bg-surface lg:bg-surface-muted">
      <OnboardingHeader activePart={partIndex} />
      <main className="flex flex-1 flex-col lg:items-center lg:px-6 lg:pt-12 lg:pb-16">
        <form
          noValidate
          onSubmit={handleSubmit}
          aria-labelledby={titleId}
          className="flex flex-1 flex-col lg:w-full lg:max-w-[738px] lg:flex-none lg:rounded-card lg:border lg:border-line lg:bg-surface lg:px-12 lg:pt-10 lg:pb-10.5"
        >
          <MobileProgress position={position} onBack={onBack} />

          <div className="flex flex-col px-5 pt-8 lg:p-0">
            <p className="hidden text-label font-bold text-primary-strong lg:block">
              Phần {partIndex + 1}/{ONBOARDING_PARTS.length} · {ONBOARDING_PARTS[partIndex]} · câu {questionNumber}/
              {questionCount}
            </p>
            <h1
              id={titleId}
              ref={headingRef}
              tabIndex={-1}
              aria-describedby={error ? errorIdFor(titleId) : undefined}
              className="text-question-sm font-extrabold text-ink outline-none lg:mt-3 lg:text-question"
            >
              {title}
            </h1>
            {helper ? <p className="mt-2 text-lead-sm text-ink-muted lg:text-lead">{helper}</p> : null}

            <div className="mt-5 flex flex-col gap-5 lg:mt-6 lg:gap-6">
              {error ? (
                <div
                  id={errorIdFor(titleId)}
                  role="alert"
                  className="flex items-start gap-2.5 rounded-control border border-danger bg-danger-soft px-3.5 py-3 text-label leading-[20.3px] font-semibold text-danger-strong"
                >
                  <Icon name="alert-circle" size={18} className="mt-px text-danger" />
                  <p>{error}</p>
                </div>
              ) : null}
              {children}
            </div>
          </div>

          <div className="sticky bottom-0 mt-auto bg-surface px-5 pt-5 pb-[max(env(safe-area-inset-bottom),32px)] lg:static lg:mt-8 lg:flex lg:items-center lg:gap-4 lg:bg-transparent lg:p-0">
            <div className="hidden lg:mr-auto lg:block">
              <Button
                variant="secondary"
                size="2xl"
                onClick={onBack}
                className="lg:h-14.5 lg:px-5.5 lg:text-button"
              >
                <Icon name="chevron-left" size={18} className="mr-1.5 align-[-3px]" />
                Quay lại
              </Button>
            </div>
            {hint ? (
              <p aria-live="polite" className={`mb-3 text-center lg:mb-0 ${hintClass}`}>
                {hint.text}
              </p>
            ) : (
              <p className="hidden text-caption text-ink-muted lg:block">Nhấn Enter để tiếp tục</p>
            )}
            <Button
              type="submit"
              size="2xl"
              fullWidth
              loading={submitting}
              loadingLabel="Đang lưu…"
              className="lg:w-auto lg:px-8"
            >
              {submitLabel}
              <Icon name="arrow-right" size={20} className="ml-2 align-[-4px]" />
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
