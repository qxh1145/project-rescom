"use client";

import Image from "next/image";
import Link from "next/link";
import { Mascot } from "@/components/brand/Mascot";
import { Button, buttonClassName } from "@/components/ui/Button";
import type { SurveyFeedbackStatusDto } from "@rescom/schemas";
import type { CompletionKind, CompletionView } from "@/lib/participation/completion-view";
import { useFeedbackForm } from "../hooks/use-feedback-form";
import { ActivationCard, CompletionDesktopHeader, RewardPill } from "./CompletionParts";
import { FEEDBACK_FORM_ID, FeedbackDoneCard, FeedbackFormCard } from "./FeedbackPanel";

/**
 * Figma 6 "Hoàn thành & đánh giá": desktop 62:1761 (celebration left, rating
 * form right, hills behind), mobile 62:2047 (hills hero, cards, sticky
 * "Để sau" / "Gửi đánh giá"). The activation card appears only when this
 * attempt unlocked the starter points.
 */
export function SuccessView({
  attemptId,
  surveyTitle,
  view,
  feedbackStatus,
}: {
  attemptId: string;
  surveyTitle: string;
  view: CompletionView & { kind: Exclude<CompletionKind, "held"> };
  feedbackStatus: SurveyFeedbackStatusDto | null;
}) {
  const form = useFeedbackForm(attemptId, feedbackStatus);

  const later = (size: "xl" | "lg", className = "") => (
    <Link href="/marketplace" className={buttonClassName({ variant: "secondary", size, className })}>
      Để sau
    </Link>
  );
  const send = (className = "") => (
    <Button type="submit" form={FEEDBACK_FORM_ID} size="lg" className={className} loading={form.busy} loadingLabel="Đang gửi…">
      Gửi đánh giá
    </Button>
  );

  const rating = form.open ? (
    <FeedbackFormCard
      form={form}
      surveyTitle={surveyTitle}
      actions={
        <>
          {later("xl", "w-[98px]")}
          {send("flex-1")}
        </>
      }
    />
  ) : (
    <FeedbackDoneCard sent={form.sent !== null} />
  );

  // One layout tree (responsive classes) so the rating form, its ids and the
  // sticky mobile "Gửi đánh giá" (form=…) exist exactly once.
  return (
    <>
      <CompletionDesktopHeader />

      <main className="relative flex flex-1 flex-col lg:block lg:overflow-hidden lg:bg-surface-hero">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-[520px] lg:block">
          <Image src="/brand/hills-desktop.jpg" alt="" fill sizes="100vw" className="object-cover object-top" />
        </div>
        <div className="relative flex flex-col lg:mx-auto lg:max-w-[1100px] lg:flex-row lg:items-start lg:justify-center lg:gap-[38px] lg:px-6 lg:pt-12 lg:pb-24">
          {/* Desktop celebration (left column). */}
          <section className="hidden w-[434px] shrink-0 flex-col items-center pt-3 text-center lg:flex">
            <Mascot name="cheer" height={220} />
            <h1 className="mt-[15px] text-[36px] font-extrabold tracking-[-0.7px] text-ink">Nộp bài thành công!</h1>
            <div className="mt-[18px]">
              <RewardPill amount={view.amount} kind={view.kind} />
            </div>
            {view.activated ? (
              <div className="mt-6 text-left">
                <ActivationCard />
              </div>
            ) : null}
          </section>

          {/* Mobile hills hero. */}
          <section className="relative h-[330px] shrink-0 overflow-hidden lg:hidden">
            <Image src="/brand/hills-mobile.jpg" alt="" fill priority sizes="100vw" className="object-cover" />
            <div className="relative flex h-full flex-col items-center pt-[max(env(safe-area-inset-top),16px)] text-center">
              <h1 className="mt-10 text-[26px] font-extrabold tracking-[-0.5px] text-ink">Nộp bài thành công!</h1>
              <div className="mt-2">
                <RewardPill amount={view.amount} kind={view.kind} />
              </div>
              <div className="mt-auto">
                <Mascot name="cheer" height={160} />
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-3.5 px-5 pb-8 lg:w-[586px] lg:shrink-0 lg:p-0">
            {view.activated ? (
              <div className="lg:hidden">
                <ActivationCard />
              </div>
            ) : null}
            <div className={view.activated ? "" : "mt-4 lg:mt-0"}>{rating}</div>
          </div>
        </div>

        {form.open ? (
          <div className="sticky bottom-0 z-20 mt-auto flex gap-3 border-t border-line bg-surface px-5 pt-3.5 pb-[max(env(safe-area-inset-bottom),14px)] lg:hidden">
            {later("xl", "w-[94px] px-0")}
            {send("flex-1")}
          </div>
        ) : null}
      </main>
    </>
  );
}
