"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { DemographicOnboardingNextStep } from "@rescom/schemas";
import { Mascot } from "@/components/brand/Mascot";
import { buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { GOAL_LABELS, type OnboardingGoal, type SummaryItem } from "@/lib/onboarding/onboarding-answers";
import { ONBOARDING_PARTS } from "@/lib/onboarding/onboarding-steps";
import { OnboardingHeader } from "./OnboardingHeader";

/** ASSUMED: where "Xem cách tạo khảo sát" leads until the publisher guide exists (Phase 5). */
const CREATE_SURVEY_HREF = "/forms/new";

interface DoneScreenProps {
  name: string;
  goal: OnboardingGoal | null;
  nextStep: DemographicOnboardingNextStep;
  continueHref: string;
  editHref: string;
  summary: SummaryItem[];
  /** Called when the screen unmounts (leaving it by any route): trims the local draft. */
  onLeave: () => void;
}

/**
 * "12 · Hoàn tất" — Figma draws goal "Cả hai" (desktop 62:1927, mobile 62:1998).
 * ASSUMED for the other cases: "Làm khảo sát, tích điểm" shows step 1 only;
 * an already activated user (`nextStep: COMPLETED`) sees a plain "next" card.
 */
export function DoneScreen({ name, goal, nextStep, continueHref, editHref, summary, onLeave }: DoneScreenProps) {
  const activated = nextStep === "COMPLETED";
  const showCreate = goal !== "EARN";
  const goalLabel = GOAL_LABELS[goal ?? "BOTH"];
  const count = showCreate ? "2 việc" : "việc";
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => onLeave, [onLeave]);

  return (
    <div className="flex min-h-dvh flex-col bg-surface lg:bg-surface-muted">
      <OnboardingHeader activePart={ONBOARDING_PARTS.length} />
      <main className="flex flex-1 flex-col items-center px-5 pt-[max(env(safe-area-inset-top),16px)] pb-[max(env(safe-area-inset-bottom),32px)] lg:px-6 lg:pt-10 lg:pb-16">
        <Mascot name="cheer" height={140} className="lg:hidden" />
        <Mascot name="cheer" height={150} className="hidden lg:block" />
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="mt-2.5 text-center outline-none text-question-sm font-extrabold text-ink lg:mt-2 lg:text-[36px] lg:leading-normal lg:tracking-[-0.7px]"
        >
          Xong rồi, {name}!
        </h1>
        <p className="mt-2.5 max-w-85.5 text-center text-lead-sm text-ink-muted lg:mt-3 lg:max-w-none lg:text-lead">
          Hồ sơ đã sẵn sàng. Đây là {count} tiếp theo cho mục tiêu “{goalLabel}”.
        </p>

        <div className="mt-6 grid w-full max-w-87.5 gap-3 lg:mt-7 lg:max-w-225 lg:grid-cols-2 lg:gap-5">
          {/* Step 1 (62:1976): amber card, primary CTA. */}
          <section className="flex flex-col rounded-[18px] bg-tone-amber-bg p-4 lg:rounded-[22px] lg:p-6">
            <div className="flex items-start gap-3 lg:gap-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-field bg-tone-amber-accent text-ink lg:size-12 lg:rounded-control">
                <Icon name="lock" size={22} className="hidden lg:block" />
                <Icon name="lock" size={20} className="lg:hidden" />
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-bold tracking-[0.5px] text-tone-amber-fg">
                  {activated ? "TIẾP THEO" : "BƯỚC 1 · NGAY BÂY GIỜ"}
                </p>
                <h2 className="mt-0.5 text-button font-extrabold text-ink lg:text-[19px]">
                  {activated ? "Xem khảo sát mới hợp với hồ sơ của bạn" : "Làm 1 khảo sát để mở khoá 100 điểm khởi đầu"}
                </h2>
              </div>
            </div>
            <Link
              href={continueHref}
              className={buttonClassName({ size: "2xl", fullWidth: true, className: "mt-3 lg:mt-auto" })}
            >
              <span>
                Xem khảo sát hợp với bạn
                <Icon name="arrow-right" size={20} className="ml-2 align-[-4px]" />
              </span>
            </Link>
          </section>

          {showCreate ? (
            /* Step 2 (62:1987): outlined card; desktop outline button, mobile text link. */
            <section className="flex flex-col rounded-[18px] border border-line bg-surface p-4 lg:rounded-[22px] lg:p-6">
              <div className="flex items-start gap-3 lg:gap-3.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-field bg-tone-teal-bg text-tone-teal-fg lg:size-12 lg:rounded-control">
                  <Icon name="bar-chart" size={22} className="hidden lg:block" />
                  <Icon name="bar-chart" size={20} className="lg:hidden" />
                </span>
                <div className="min-w-0">
                  <p className="text-[12px] font-bold tracking-[0.5px] text-ink-muted">
                    {activated ? "BẠN CŨNG CÓ THỂ" : "BƯỚC 2 · SAU KHI MỞ KHOÁ"}
                  </p>
                  <h2 className="mt-0.5 text-button font-extrabold text-ink lg:text-[19px]">
                    Tạo khảo sát cho nghiên cứu của bạn
                  </h2>
                  <p className="mt-1.5 text-caption leading-[18.9px] text-ink-muted lg:text-body-sm">
                    100 điểm đủ cho 10 người trả lời một khảo sát 5–10 phút.
                  </p>
                  <Link
                    href={CREATE_SURVEY_HREF}
                    className="mt-3 inline-block text-label font-bold text-primary hover:underline lg:hidden"
                  >
                    Xem cách tạo khảo sát →
                  </Link>
                </div>
              </div>
              <Link
                href={CREATE_SURVEY_HREF}
                className="mt-auto hidden h-14.5 items-center justify-center rounded-control border border-primary text-button font-bold text-primary transition-colors hover:bg-primary/5 lg:flex"
              >
                Xem cách tạo khảo sát
              </Link>
            </section>
          ) : null}
        </div>

        <p className="mt-auto flex w-full max-w-87.5 items-baseline justify-between gap-3 pt-8 lg:mt-7 lg:max-w-none lg:justify-center lg:gap-1.5 lg:pt-0">
          <span className="text-caption leading-[18.9px] text-ink-muted lg:text-body-sm">
            <span className="hidden lg:inline">Hồ sơ: </span>
            {summary.map((item, index) => (
              <span key={item.field} className={item.desktopOnly ? "hidden lg:inline" : undefined}>
                {index > 0 ? " · " : ""}
                {item.text}
              </span>
            ))}
          </span>
          <Link href={editHref} className="shrink-0 text-label font-bold text-primary hover:underline">
            <span className="lg:hidden">Sửa hồ sơ</span>
            <span className="hidden lg:inline">Sửa</span>
          </Link>
        </p>
      </main>
    </div>
  );
}
