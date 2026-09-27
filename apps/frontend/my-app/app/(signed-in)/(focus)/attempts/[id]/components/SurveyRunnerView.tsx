"use client";

import type { ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import type { AttemptDetails } from "@/lib/participation/attempts-service";
import { pageRangeLabel } from "@/lib/participation/survey-form";
import { formatEffortMinutes, type SurveyForm } from "@/lib/participation/survey-form-service";
import { useSurveyRunner } from "../hooks/use-survey-runner";
import { QuestionCard } from "./QuestionCard";
import { DesktopSurveyHeader, MobileSurveyHeader, PaceNotice, RewardCard, SectionNav } from "./SurveyChrome";
import { ExpiredPanel, SubmitFailedPanel } from "./StatusPanels";

/**
 * Figma 4 "Làm khảo sát trong RESCOM": desktop 62:158 (720px questions +
 * 300px sidebar), mobile 62:732 (sticky header and action bar), 4b 62:1019
 * (submit failed offline). Desktop 4b and the expired state are ASSUMED.
 */
export function SurveyRunnerView({ attempt, form }: { attempt: AttemptDetails; form: SurveyForm }) {
  const run = useSurveyRunner(attempt, form);
  const { layout, page } = run;
  const total = layout.total;
  const offline = run.showOffline;
  const expired = run.phase === "expired";
  const shownPage = offline ? layout.pages[layout.pages.length - 1] : page;
  const reached = offline ? total : (shownPage?.lastNumber ?? 0);
  const rangeLabel = shownPage ? pageRangeLabel(shownPage, total) : `Câu 0 / ${total}`;
  const section = page ? layout.sections[page.sectionIndex] : undefined;
  const reward = attempt.survey.rewardPerResponse;
  const submitting = run.phase === "submitting";
  const blocked = run.barrierSeconds > 0;

  const notices: ReactNode = (
    <>
      {blocked ? (
        <Alert tone="info">
          Bạn đang làm nhanh hơn thời gian tối thiểu của khảo sát. Hãy đọc lại câu trả lời — có thể nộp sau{" "}
          {run.barrierSeconds} giây.
        </Alert>
      ) : null}
      {run.submitError ? <Alert tone="danger">{run.submitError}</Alert> : null}
    </>
  );

  const primary = offline ? (
    <Button
      size="lg"
      className="flex-1 lg:flex-none lg:px-7"
      onClick={() => void run.submit()}
      loading={submitting}
      loadingLabel="Đang gửi lại…"
      leadingIcon={<Icon name="refresh" size={18} />}
    >
      Thử gửi lại
    </Button>
  ) : run.isLastPage ? (
    <Button
      size="lg"
      className="flex-1 lg:flex-none lg:px-7"
      onClick={() => void run.submit()}
      loading={submitting}
      loadingLabel="Đang gửi…"
      disabled={blocked}
    >
      {blocked ? `Nộp bài (${run.barrierSeconds}s)` : "Nộp bài"}
    </Button>
  ) : (
    <Button size="lg" className="flex-1 lg:flex-none lg:pr-6 lg:pl-7" onClick={run.next}>
      Tiếp tục
      <Icon name="arrow-right" size={20} className="ml-2.5 align-[-4px]" />
    </Button>
  );

  const secondary = offline ? (
    <Button variant="secondary" size="lg" className="w-[102px] lg:w-auto lg:px-6" onClick={run.review} disabled={submitting}>
      Xem lại
    </Button>
  ) : run.pageIndex > 0 ? (
    <Button variant="secondary" size="lg" className="w-[110px] lg:w-[118px]" onClick={run.back} disabled={submitting}>
      Quay lại
    </Button>
  ) : null;

  const actions = expired ? null : (
    <>
      {secondary ?? <span className="hidden lg:block" />}
      {primary}
    </>
  );

  return (
    <>
      <DesktopSurveyHeader answeredUpTo={reached} total={total} onSaveAndExit={run.saveAndExit} />
      <MobileSurveyHeader
        title={attempt.survey.title}
        rangeLabel={rangeLabel}
        reward={reward}
        answeredUpTo={reached}
        total={total}
        onSaveAndExit={run.saveAndExit}
      />

      <main className="flex-1">
        <div className="mx-auto flex w-full max-w-[1100px] gap-8 px-5 pt-5 pb-8 lg:px-6 lg:pt-8 lg:pb-16">
          <div className="flex min-w-0 flex-1 flex-col lg:max-w-[720px]">
            <div className="mb-[21px] hidden flex-col gap-1.5 lg:flex">
              {section && layout.sections.length > 1 ? (
                <p className="text-caption font-bold text-tone-teal-fg">
                  Phần {section.number} · {section.title}
                </p>
              ) : null}
              <h1 className="text-[28px] font-extrabold tracking-[-0.6px] text-ink">{attempt.survey.title}</h1>
            </div>
            <h1 className="sr-only lg:hidden">{attempt.survey.title}</h1>

            {expired ? (
              <ExpiredPanel restartHref={`/surveys/${attempt.formId}/start`} onRestart={run.forgetDraft} />
            ) : offline ? (
              <SubmitFailedPanel
                answered={run.answeredCount}
                total={total}
                savedAt={run.savedAt}
                expiresAt={attempt.expiresAt}
              />
            ) : (
              <div className="flex flex-col gap-4 lg:gap-5">
                {page?.blocks.map((block) => (
                  <QuestionCard
                    key={block.id}
                    block={block}
                    number={layout.numbers[block.id]}
                    value={run.answers[block.id]}
                    error={run.errors[block.id]}
                    onChange={(value) => run.setAnswer(block, value)}
                    onBlur={() => run.blurAnswer(block)}
                  />
                ))}
              </div>
            )}

            <div className="mt-4 flex flex-col gap-3 empty:hidden">{notices}</div>

            {actions ? <div className="mt-6 hidden items-center justify-between gap-3 lg:flex">{actions}</div> : null}

            {!expired && !offline ? (
              <div className="mt-4 lg:hidden">
                <PaceNotice variant="mobile" />
              </div>
            ) : null}
          </div>

          <aside className="hidden w-[300px] shrink-0 flex-col gap-4 lg:flex">
            <RewardCard
              reward={reward}
              effort={formatEffortMinutes(attempt.survey.estimatedEffortSeconds)}
              publisher={attempt.survey.publisherName}
            />
            {layout.sections.length > 1 ? (
              <SectionNav
                sections={layout.sections}
                currentIndex={offline ? layout.sections.length : (page?.sectionIndex ?? 0)}
                furthestIndex={offline ? layout.sections.length - 1 : run.furthestSection}
                onJump={run.jumpToSection}
              />
            ) : null}
            <PaceNotice variant="desktop" />
          </aside>
        </div>
      </main>

      {actions ? (
        <div className="sticky bottom-0 z-20 flex gap-3 border-t border-line bg-surface px-5 pt-3.5 pb-[max(env(safe-area-inset-bottom),14px)] lg:hidden">
          {secondary}
          {primary}
        </div>
      ) : null}
    </>
  );
}
