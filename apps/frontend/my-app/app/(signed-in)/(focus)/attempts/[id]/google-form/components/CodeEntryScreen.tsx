"use client";

import type { ReactNode } from "react";
import { Mascot } from "@/components/brand/Mascot";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { OtpInput } from "@/components/ui/OtpInput";
import type { AttemptDetails } from "@/lib/participation/attempts-service";
import { COMPLETION_CODE_LENGTH } from "@/lib/participation/external-code";
import { EXTERNAL_MESSAGES } from "@/lib/participation/external-messages";
import type { GoogleFormAttemptState } from "../hooks/use-google-form-attempt";

interface CodeEntryScreenProps {
  attempt: AttemptDetails;
  state: GoogleFormAttemptState;
  onReport: () => void;
}

const HELP_ID = "completion-code-help";

/**
 * Figma 5 desktop (62:2): steps panel | code panel. Mobile (62:359): opened
 * card, code card, 48h note, sticky confirm. Wrong code (62:784, mobile only
 * drawn — desktop ASSUMED (design) to show the same alert in the code panel).
 */
export function CodeEntryScreen({ attempt, state, onReport }: CodeEntryScreenProps) {
  // Validated against the shared Google Forms allowlist (`externalSurveyUrlSchema`).
  const url = state.formUrl;
  const wrong = state.wrong;
  const counting = state.remainingSeconds > 0;

  const confirmButton = (
    <Button
      size="lg"
      fullWidth
      onClick={state.confirm}
      disabled={!state.canConfirm}
      loading={state.busy}
      loadingLabel="Đang xác nhận…"
      leadingIcon={counting ? <Icon name="clock" size={18} /> : undefined}
      // Static name while counting down (the timer above carries the time).
      aria-label={counting && !state.busy ? "Xác nhận mã (chưa đủ thời gian làm bài)" : undefined}
    >
      {counting ? <span aria-hidden="true">Nhập được mã sau {state.countdown}</span> : "Xác nhận mã"}
    </Button>
  );

  return (
    <>
      <main className="flex flex-1 flex-col gap-4 px-5 pb-6 pt-5 lg:items-center lg:px-12 lg:pb-12 lg:pt-12">
        {!url ? (
          <Alert tone="danger">
            {state.formUrlInvalid ? EXTERNAL_MESSAGES.formUrlInvalid : EXTERNAL_MESSAGES.formUrlMissing}
          </Alert>
        ) : null}

        {/* Mobile: step 1 card (hidden in 5b, which shows "Mở lại Google Form" below instead). */}
        {!wrong ? (
          <OpenFormCard url={url} opened={state.opened} onOpen={state.markOpened} />
        ) : null}

        <div className="flex flex-col overflow-hidden rounded-[18px] border border-line bg-surface lg:min-h-[578px] lg:w-full lg:max-w-[962px] lg:flex-row lg:rounded-[28px]">
          <StepsPanel attempt={attempt} url={url} opened={state.opened} onOpen={state.markOpened} onReport={onReport} />

          <section
            aria-label="Nhập mã hoàn thành"
            data-tour="gf-code"
            className="flex flex-col px-5 pb-5 pt-5 lg:w-1/2 lg:bg-surface-panel lg:px-10 lg:pb-10 lg:pt-10"
          >
            <div className="flex flex-col items-center text-center">
              {wrong ? (
                <Mascot name="confused" height={110} />
              ) : (
                <>
                  <Mascot name="phone" height={120} className="lg:hidden" />
                  <Mascot name="phone" height={150} className="hidden lg:block" />
                </>
              )}
              <div role="timer" className="mt-3.5 lg:mt-4">
                {counting ? (
                  <>
                    <p className="text-[13px] font-semibold text-ink-muted lg:text-label">Có thể nhập mã sau</p>
                    <p className="text-[40px] font-extrabold tracking-[0.8px] text-primary tabular-nums lg:text-[48px] lg:tracking-normal">
                      <span className="sr-only">còn </span>
                      {state.countdown}
                    </p>
                  </>
                ) : (
                  <p className="flex items-center justify-center gap-1.5 text-label font-semibold text-tone-teal-fg">
                    <Icon name="check" size={16} />
                    Đã đủ thời gian làm bài
                  </p>
                )}
              </div>
            </div>

            <p id="completion-code-label" className="mt-4 text-label font-semibold text-ink lg:mt-5">
              Mã hoàn thành
            </p>
            <div className="mt-3">
              <OtpInput
                value={state.code}
                onChange={state.setCode}
                length={COMPLETION_CODE_LENGTH}
                size="responsive"
                invalid={state.invalid}
                label="Mã hoàn thành"
                describedBy={HELP_ID}
              />
            </div>

            {wrong ? (
              <div role="alert" className="mt-3.5 flex gap-2 rounded-field bg-danger-soft px-3 py-3">
                <Icon name="alert-circle" size={18} className="mt-px text-danger" />
                <div>
                  <p className="text-label font-bold text-danger-strong">
                    {EXTERNAL_MESSAGES.wrongCodeTitle(wrong.remainingTries)}
                  </p>
                  <p className="mt-0.5 text-[13px] leading-[18.9px] text-ink">{EXTERNAL_MESSAGES.wrongCodeBody}</p>
                </div>
              </div>
            ) : null}
            {state.notice ? (
              <Alert tone={state.notice.tone} className="mt-3.5">
                {state.notice.text}
              </Alert>
            ) : null}

            <div className="mt-4.5 hidden lg:block">{confirmButton}</div>
            <p
              id={HELP_ID}
              className={`mt-3.5 text-[12px] leading-4.5 text-ink-muted lg:mt-4 lg:text-center lg:text-caption-relaxed ${wrong ? "sr-only lg:not-sr-only" : ""}`}
            >
              Có thể dán mã ngay; nút xác nhận mở khi hết giờ. Nhập sai 3 lần sẽ khoá lượt làm này.
            </p>
          </section>
        </div>

        {wrong && url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={state.markOpened}
            className="flex items-center justify-center gap-1.5 self-center text-label font-semibold text-primary lg:hidden"
          >
            <Icon name="external-link" size={16} />
            Mở lại Google Form
            <span className="sr-only"> (mở trong tab mới)</span>
          </a>
        ) : null}

        {!wrong ? (
          <p className="flex gap-2.5 rounded-[14px] bg-tone-amber-bg px-3.5 py-3 text-[13px] leading-[18.9px] text-ink lg:hidden">
            <Icon name="hourglass" size={20} className="text-tone-amber-fg" />
            <span>
              Điểm từ Google Forms vào mục <strong className="font-bold">Chờ duyệt 48 giờ</strong> để người đăng
              kiểm tra, sau đó tự chuyển sang Khả dụng.
            </span>
          </p>
        ) : null}

        <ReportLink onClick={onReport} className="self-center lg:hidden" />
      </main>

      {/* Mobile sticky confirm (62:421). */}
      <div className="sticky bottom-0 z-20 border-t border-line bg-surface px-5 pt-3.5 pb-[max(14px,env(safe-area-inset-bottom))] lg:hidden">
        {confirmButton}
      </div>
    </>
  );
}

function ReportLink({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-1.5 text-label font-semibold text-primary hover:underline ${className}`}
    >
      <Icon name="flag" size={16} />
      Không thấy mã ở cuối form? Báo Admin
    </button>
  );
}

interface OpenFormProps {
  url: string | null;
  opened: boolean;
  onOpen: () => void;
}

/** Mobile "Đã mở Google Form … Mở lại" card (62:368). Not-yet-opened variant ASSUMED. */
function OpenFormCard({ url, opened, onOpen }: OpenFormProps) {
  return (
    <div className="flex items-center gap-3 rounded-[18px] border border-line bg-surface p-4 lg:hidden">
      <StepBadge state={opened ? "done" : "current"} number={1} />
      <div className="min-w-0 flex-1">
        <p className="text-body font-bold text-ink">{opened ? "Đã mở Google Form" : "Mở Google Form"}</p>
        <p className="text-caption text-ink-muted">
          {opened ? "Làm xong, chép mã 6 số ở trang cảm ơn." : "Làm hết form rồi chép mã 6 số ở trang cảm ơn."}
        </p>
      </div>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onOpen}
          className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-bold ${
            opened ? "bg-tone-green-bg text-tone-green-fg" : "bg-primary text-primary-foreground"
          }`}
        >
          {opened ? "Mở lại" : "Mở form"}
          <Icon name="external-link" size={12} />
          <span className="sr-only"> (mở trong tab mới)</span>
        </a>
      ) : null}
    </div>
  );
}

function StepBadge({ state, number }: { state: "done" | "current" | "upcoming"; number: number }) {
  const classes =
    state === "done"
      ? "bg-step-done text-ink"
      : state === "current"
        ? "bg-primary text-primary-foreground"
        : "bg-line text-ink-muted";
  return (
    <span
      aria-hidden="true"
      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-button font-extrabold ${classes}`}
    >
      {state === "done" ? <Icon name="check" size={18} /> : number}
    </span>
  );
}

function Step({
  state,
  number,
  title,
  children,
}: {
  state: "done" | "current" | "upcoming";
  number: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3.5" aria-current={state === "current" ? "step" : undefined}>
      <StepBadge state={state} number={number} />
      <div className="min-w-0 pt-px">
        <p className="text-button font-bold text-ink">
          {title}
          {state === "done" ? <span className="sr-only"> (đã xong)</span> : null}
        </p>
        <div className="mt-1 text-body-sm text-ink-muted">{children}</div>
      </div>
    </li>
  );
}

/** Desktop left panel (62:8): tags, title, 3 steps, report link. */
function StepsPanel({ attempt, url, opened, onOpen, onReport }: OpenFormProps & { attempt: AttemptDetails; onReport: () => void }) {
  return (
    <section
      aria-label="Các bước"
      className="hidden flex-col border-r border-line px-10 pb-10 pt-10 lg:flex lg:w-1/2"
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex h-6.5 items-center rounded-full bg-tone-blue-bg px-2.5 text-[12px] font-bold text-tone-blue-fg">
          Google Forms
        </span>
        <span className="inline-flex h-7.5 items-center rounded-full bg-tone-amber-bg px-2.5 text-label font-extrabold text-tone-amber-fg">
          +{attempt.survey.rewardPerResponse} điểm
        </span>
      </div>
      <h1
        data-focus-heading
        tabIndex={-1}
        className="mt-5 max-w-[399px] text-title leading-[33.8px] font-extrabold text-ink focus:outline-none"
      >
        {attempt.survey.title}
      </h1>

      <ol data-tour="gf-steps" className="mt-5 flex flex-col gap-4">
        <Step state={opened ? "done" : "current"} number={1} title="Mở Google Form">
          {opened ? (
            <>
              Đã mở trong tab mới.{" "}
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" onClick={onOpen} className="font-bold text-primary hover:underline">
                  Mở lại<span className="sr-only"> Google Form (tab mới)</span>
                </a>
              ) : null}
            </>
          ) : (
            <span className="flex flex-col items-start">
              <span>Form mở trong tab mới, giữ tab này để nhập mã.</span>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={onOpen}
                  className="mt-2.5 inline-flex h-10 items-center gap-2 rounded-control bg-primary px-4 text-label font-bold text-primary-foreground hover:bg-primary-hover"
                >
                  <Icon name="external-link" size={16} />
                  Mở Google Form
                  <span className="sr-only"> (tab mới)</span>
                </a>
              ) : null}
            </span>
          )}
        </Step>
        <Step state={opened ? "current" : "upcoming"} number={2} title="Làm hết form, chép mã 6 số">
          Mã nằm ở trang cảm ơn cuối form.
        </Step>
        <Step state="upcoming" number={3} title="Nhập mã tại đây">
          Điểm vào mục Chờ duyệt 48 giờ, rồi tự chuyển sang Khả dụng.
        </Step>
      </ol>

      <ReportLink onClick={onReport} className="mt-auto self-start pt-8" />
    </section>
  );
}
