"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Spinner } from "@/components/ui/Spinner";
import { formatDayMonth } from "@/lib/format/date-time";
import { useFormHeader } from "@/lib/forms/manage-header-context";
import { progressErrorMessage } from "@/lib/forms/manage-messages";
import type { FormProgress, ProgressRange, PublisherForm } from "@/lib/forms/manage-service";
import { canEditLive, canReopen, canWithdraw, resubmitHref, statusViewOf, type PublisherStatusView } from "@/lib/forms/manage-status";
import { daysUntil, formatFullDate, seriesBuckets, seriesSummary } from "@/lib/forms/manage-view";
import { RESPONSE_EXPORT_ENABLED } from "@/lib/forms/results-scope";
import { StatusPill } from "../../components/StatusPill";
import { useFormActions } from "../hooks/use-form-actions";
import { useFormProgress } from "../hooks/use-form-progress";
import { OpensChart } from "./OpensChart";
import { AnswersNote, CARD, CARD_TITLE, PendingAttemptsCard } from "./ProgressCards";

const RANGE_SEGMENTS: readonly { value: ProgressRange; label: string }[] = [
  { value: "hour", label: "Giờ" },
  { value: "day", label: "Ngày" },
  { value: "week", label: "Tuần" },
  { value: "month", label: "Tháng" },
];

function StatCard({ label, value, sub, accent = false }: { label: string; value: ReactNode; sub: ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-[18px] border border-line bg-surface px-4.5 py-4">
      <p className="text-caption font-semibold text-ink-muted">{label}</p>
      <p className={`mt-2 text-[30px] leading-7.5 font-extrabold ${accent ? "text-tone-amber-fg" : "text-ink"}`}>{value}</p>
      <div className="mt-2.5 text-[12px] text-ink-muted">{sub}</div>
    </div>
  );
}

function MiniStat({ label, value, sub, className = "" }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className={`rounded-xl bg-surface-muted px-3 py-2.5 lg:rounded-[14px] lg:px-3.5 lg:py-3 ${className}`}>
      <p className="text-[12px] font-semibold text-ink-muted">{label}</p>
      <p className="mt-0.5 text-[18px] font-extrabold text-ink lg:text-[20px]">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-ink-muted lg:text-[12px]">{sub}</p> : null}
    </div>
  );
}

function deadlineFacts(form: PublisherForm, view: PublisherStatusView, now: number) {
  if (view === "FULL" || view === "ENDED") {
    return { value: "Đã kết thúc", sub: form.closedAt ? `Ngày ${formatFullDate(form.closedAt)}` : "", short: "Đã kết thúc" };
  }
  const days = daysUntil(form.deadlineAt, now);
  if (days === null) return { value: "Chưa có", sub: "Không đặt hạn", short: null };
  return {
    value: `${days} ngày`,
    sub: `Đến ${formatFullDate(form.deadlineAt)}`,
    short: `Hạn ${formatDayMonth(form.deadlineAt)} · còn ${days} ngày`,
  };
}

/** Mobile status card buttons (Figma 62:3324–62:3328); ended surveys get the 10b/17 links. */
function MobileStatusActions({ form, view }: { form: PublisherForm; view: PublisherStatusView }) {
  const { requestClose, requestEdit } = useFormActions();
  const id = encodeURIComponent(form.id);
  const button =
    "inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-field border border-line-strong bg-surface text-label font-bold text-ink disabled:opacity-60";
  if (view === "RUNNING") {
    return (
      <div className="mt-3.5 flex gap-2">
        {canEditLive(form) ? (
          <button type="button" className={button} onClick={requestEdit}>
            <Icon name="pencil" size={16} />
            Chỉnh sửa
          </button>
        ) : null}
        <button type="button" className={button} onClick={requestClose}>
          Đóng &amp; hoàn điểm
        </button>
      </div>
    );
  }
  // Phase 5 M7: withdraw a survey waiting for review / a re-versioned draft.
  if (canWithdraw(form, form.currentVersion.versionNumber)) {
    return (
      <div className="mt-3.5 flex gap-2">
        <button type="button" className={button} onClick={requestClose}>
          Rút lại &amp; hoàn điểm
        </button>
      </div>
    );
  }
  if ((view === "FULL" || view === "ENDED") && (canReopen(form) || (RESPONSE_EXPORT_ENABLED && form.type === "INTERNAL"))) {
    return (
      <div className="mt-3.5 flex gap-2">
        {canReopen(form) ? (
          <Link
            href={`/forms/${id}/reopen`}
            scroll={false}
            className="inline-flex h-11.5 flex-1 items-center justify-center rounded-field border border-primary bg-surface text-body font-bold text-primary"
          >
            Mở lại thêm mẫu
          </Link>
        ) : null}
        {RESPONSE_EXPORT_ENABLED && form.type === "INTERNAL" ? (
          <Link
            href={`/forms/${id}/export`}
            className="inline-flex h-11.5 flex-1 items-center justify-center gap-2 rounded-field bg-primary text-body font-bold text-primary-foreground"
          >
            <Icon name="download" size={18} />
            Xuất dữ liệu
          </Link>
        ) : null}
      </div>
    );
  }
  return null;
}

function RejectedPanel({ form }: { form: PublisherForm }) {
  return (
    <section aria-labelledby="rejected-title" className={CARD}>
      <h2 id="rejected-title" className={CARD_TITLE}>
        Khảo sát bị từ chối
      </h2>
      {/* `rejection` comes from `GET /forms/:id`; without it (legacy row), show no reason and an amount-free refund line. */}
      {form.rejection?.reason ? (
        <div className="mt-3 rounded-field bg-danger-soft px-3 py-2.5 text-caption leading-[18.9px]">
          <p className="font-bold text-danger-strong">Lý do từ Admin</p>
          <p className="mt-1 text-ink">{form.rejection.reason}</p>
        </div>
      ) : null}
      <p className="mt-3 text-caption font-semibold text-tone-teal-fg">
        {form.rejection
          ? `Đã hoàn ${form.rejection.refundAmount} điểm ký quỹ vào số dư`
          : "Ký quỹ đã được hoàn vào số dư"}
      </p>
      <Link
        href={resubmitHref(form)}
        className="mt-4 inline-flex h-11.5 w-full items-center justify-center rounded-field border border-line-strong bg-surface text-body font-bold text-ink hover:bg-surface-subtle lg:w-auto lg:px-6"
      >
        Sửa &amp; gửi lại
      </Link>
    </section>
  );
}

type ProgressState = ReturnType<typeof useFormProgress>;

function ProgressBody({ form, progress, state }: { form: PublisherForm; progress: FormProgress; state: ProgressState }) {
  const { range, setRange, series, seriesLoading, seriesError, reloadSeries, now } = state;
  const view = statusViewOf(form);
  const deadline = deadlineFacts(form, view, now);
  const pendingCount = progress.pendingAttempts;
  // Official surveys have no quota: show the count only.
  const official = form.isOfficial === true;
  const showPending = form.type === "EXTERNAL" && view !== "PENDING_REVIEW" && pendingCount !== null;
  const summary = series ? seriesSummary(series) : null;
  const windowShort = summary?.window.replace(/ qua$/, "") ?? "";
  const peakText = summary?.peak ? ` · nhiều nhất ${summary.peak}` : "";

  const rangeControl = (
    <SegmentedControl
      segments={RANGE_SEGMENTS}
      value={range}
      onChange={setRange}
      label="Khoảng thời gian"
      variant="bordered"
      className="max-lg:w-full max-lg:[&>button]:flex-1"
    />
  );

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      {view === "PENDING_REVIEW" ? (
        <Alert tone="info">Admin sẽ duyệt trước khi khảo sát hiện trên Khám phá. Tiến độ bắt đầu khi khảo sát được duyệt.</Alert>
      ) : null}

      {/* Desktop stat cards (62:2612–62:2628). */}
      <div data-tour="form-kpis" className="hidden gap-4 lg:grid lg:grid-cols-4">
        <StatCard
          label="Hoàn thành"
          value={
            <>
              {progress.completed}{" "}
              {official ? null : <span className="text-[18px] leading-4.5 text-ink-muted">/ {progress.expected}</span>}
            </>
          }
          sub={
            official ? (
              "Khảo sát chính thức, không giới hạn"
            ) : (
              <ProgressBar
                value={progress.completed}
                max={progress.expected}
                label={`Tiến độ ${progress.completed} trên ${progress.expected}`}
              />
            )
          }
        />
        <StatCard
          label="Điểm đã chi"
          value={progress.pointsSpent}
          sub={
            form.type === "EXTERNAL" && pendingCount !== null
              ? `${pendingCount} lượt đang chờ 48 giờ`
              : `Cho ${progress.completed} lượt hoàn thành`
          }
        />
        <StatCard label="Ký quỹ còn" value={progress.escrowRemaining} sub="Hoàn lại nếu chưa dùng hết" accent />
        <StatCard label="Hạn thu thập" value={deadline.value} sub={deadline.sub} />
      </div>

      {/* Mobile status card (62:3307). */}
      <section aria-label="Tiến độ" className={`${CARD} lg:hidden`}>
        <div className="flex items-center justify-between gap-3">
          <StatusPill view={view} />
          {deadline.short ? <span className="text-caption font-semibold text-ink-muted">{deadline.short}</span> : null}
        </div>
        <p className="mt-3 flex items-baseline gap-2">
          <span className="text-[40px] leading-10 font-extrabold text-ink">{progress.completed}</span>
          <span className="text-[18px] font-bold text-ink-muted">
            {official ? "người hoàn thành" : `/ ${progress.expected} người hoàn thành`}
          </span>
        </p>
        {official ? null : (
          <ProgressBar
            className="mt-3"
            height={10}
            value={progress.completed}
            max={progress.expected}
            label={`Tiến độ ${progress.completed} trên ${progress.expected}`}
          />
        )}
        <div className="mt-3.5 grid grid-cols-2 gap-2.5">
          <MiniStat label="Điểm đã chi" value={String(progress.pointsSpent)} />
          <div className="rounded-xl bg-surface-muted px-3 py-2.5">
            <p className="text-[12px] font-semibold text-ink-muted">Ký quỹ còn</p>
            <p className="mt-0.5 text-[18px] font-extrabold text-tone-amber-fg">{progress.escrowRemaining}</p>
          </div>
        </div>
        {/* Figma 62:3324: owner actions sit in the status card once progress has loaded. */}
        <MobileStatusActions form={form} view={view} />
      </section>

      <div
        className={`flex flex-col gap-4 lg:items-start lg:gap-5 ${showPending ? "lg:grid lg:grid-cols-[815fr_509fr]" : ""}`}
      >
        {showPending ? (
          <div className="lg:col-start-2 lg:row-start-1">
            <PendingAttemptsCard count={pendingCount ?? 0} />
          </div>
        ) : null}

        <section
          aria-labelledby="opens-title"
          className={`${CARD} lg:col-start-1 lg:row-start-1 lg:self-stretch`}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="opens-title" className={CARD_TITLE}>
                Lượt hoàn thành<span className="lg:hidden"> · {windowShort}</span>
              </h2>
              {summary ? (
                <p className="mt-1 text-caption text-ink-muted">
                  <span className="hidden lg:inline">{summary.window} · </span>
                  {summary.total} lượt hoàn thành{peakText}
                </p>
              ) : null}
            </div>
            <div className="hidden lg:block">{rangeControl}</div>
          </div>
          <div className="relative mt-2" aria-busy={seriesLoading || undefined}>
            {seriesError ? (
              <div className="flex flex-col gap-2 py-6">
                <Alert tone="danger">{progressErrorMessage(seriesError)}</Alert>
                <Button variant="secondary" size="sm" radius="field" onClick={reloadSeries} className="self-start">
                  Thử lại
                </Button>
              </div>
            ) : series && summary ? (
              <>
                <OpensChart buckets={seriesBuckets(series)} summary={summary} />
                {summary.total === 0 ? (
                  <p className="mt-2 text-caption text-ink-muted">Chưa có lượt hoàn thành nào trong khoảng này.</p>
                ) : null}
              </>
            ) : (
              <p className="flex h-40 items-center justify-center gap-2 text-caption text-ink-muted" role="status">
                <Spinner className="size-4 text-primary" />
                Đang tải biểu đồ…
              </p>
            )}
          </div>
          <div className="mt-3 lg:hidden">{rangeControl}</div>
        </section>
      </div>

      <AnswersNote />
    </div>
  );
}

/**
 * Figma 10a "Theo dõi khảo sát" — the Tiến độ tab (62:2565 desktop, 62:3292
 * mobile). `overlay` = the 10b reopen or 10c complaint dialog opened over it.
 */
export function ProgressScreen({ overlay }: { overlay?: (progress: FormProgress | undefined) => ReactNode }) {
  const { form } = useFormHeader();
  const state = useFormProgress();
  const { progress, error, loading, reload } = state;

  let body: ReactNode;
  if (!form) body = null;
  else if (statusViewOf(form) === "REJECTED") body = <RejectedPanel form={form} />;
  else if (progress) body = <ProgressBody form={form} progress={progress} state={state} />;
  else if (error) {
    body = (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <Alert tone="danger" className="flex-1">
          {progressErrorMessage(error)}
        </Alert>
        <Button variant="secondary" size="base" radius="field" onClick={reload}>
          Thử lại
        </Button>
      </div>
    );
  } else {
    body = (
      <p className="flex items-center gap-3 py-16 text-body text-ink-muted" role="status" aria-busy={loading}>
        <Spinner className="size-5 text-primary" />
        Đang tải tiến độ…
      </p>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] px-5 pt-4 pb-8 lg:px-12 lg:pt-5 lg:pb-12">
      {body}
      {/* While progress is loading/errored (or its ASSUMED route is missing), the
          status card isn't drawn: owner actions (Đóng/Mở lại/Xuất) fall back to
          `form` alone so mobile — and Google Forms surveys, whose only tab is
          Tiến độ — keep them. Desktop gets them via `HeaderActions`. */}
      {form && !progress ? (
        <div className="mt-4 lg:hidden">
          <MobileStatusActions form={form} view={statusViewOf(form)} />
        </div>
      ) : null}
      {overlay?.(progress)}
    </div>
  );
}
