"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { AppHeader } from "@/components/layout/app/AppHeader";
import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { SUPPORT_MAILTO } from "@/lib/feedback/error-pages";
import { formatEffortMinutes } from "@/lib/participation/effort-minutes";
import { FocusError, FocusLoading } from "../../../../_participation/FocusPageState";
import { useStartSurvey } from "../hooks/use-start-survey";
import { FullNoticeBody, NeverRecordedNote, PurposeParagraph, RecordedList, SurveyMeta } from "./ConsentContent";

/**
 * Figma 14 "Thông báo dữ liệu chất lượng": desktop 62:954 (inside the app
 * header), mobile 62:1163 (back bar + sticky actions).
 */
export function StartSurveyScreen() {
  const params = useParams<{ id: string }>();
  const surveyId = String(params.id);
  const router = useRouter();
  const start = useStartSurvey(surveyId);
  const [noticeOpen, setNoticeOpen] = useState(false);

  const supportLink = start.error?.support ? (
    <a href={SUPPORT_MAILTO} className="text-label font-bold text-primary hover:underline">
      Báo Admin kiểm tra
    </a>
  ) : null;

  if (start.loading) return <FocusLoading />;
  if (start.autoStart) {
    return start.error ? (
      <FocusError
        title="Chưa mở được khảo sát"
        message={start.error.message}
        tone={start.error.tone}
        // An info answer (already completed, not eligible…) cannot change on retry.
        onRetry={start.error.tone === "danger" ? start.retry : undefined}
      >
        {supportLink}
      </FocusError>
    ) : (
      <FocusLoading label="Đang mở khảo sát…" />
    );
  }
  if (start.consentError) {
    return <FocusError title="Chưa mở được khảo sát" message={start.consentError} onRetry={start.retry} />;
  }

  const summary = start.summary;
  const title = summary?.title ?? "Khảo sát trong Rescom";
  const effort = summary ? formatEffortMinutes(summary.estimatedEffortSeconds) : null;
  const reward = summary?.rewardPerResponse ?? null;
  const decline = () => router.push("/marketplace");

  const errorAlert = start.error ? (
    <div className="flex flex-col gap-2">
      <Alert tone={start.error.tone}>{start.error.message}</Alert>
      {supportLink}
    </div>
  ) : null;

  return (
    <>
      <AppHeader />
      <MobileBackBar title="Trước khi bắt đầu" backHref="/marketplace" />

      {/* Desktop — 802px card, 40px below the header. */}
      <main className="hidden flex-1 px-6 pt-10 pb-16 lg:block">
        <section
          aria-labelledby="consent-title"
          className="mx-auto flex max-w-[802px] flex-col rounded-card border border-line bg-surface px-10 pt-[30px] pb-[34px]"
        >
          <p className="text-caption">
            <Link href="/marketplace" className="font-semibold text-primary hover:underline">
              Khám phá
            </Link>
            <span className="text-ink-muted"> / {title}</span>
          </p>
          <div className="mt-[21px] flex items-center gap-3.5">
            <span className="flex size-13 shrink-0 items-center justify-center rounded-control bg-tone-amber-bg text-tone-amber-fg">
              <Icon name="shield-check" size={26} />
            </span>
            <div className="flex flex-col gap-1">
              <h1 id="consent-title" className="text-[26px] font-extrabold tracking-[-0.3px] text-ink">
                Trước khi bắt đầu
              </h1>
              <SurveyMeta effort={effort} reward={reward} />
            </div>
          </div>
          <p className="mt-5 text-lead leading-[24.8px] text-ink">
            Để đánh giá chất lượng câu trả lời công bằng, Rescom ghi lại một số tương tác của bạn{" "}
            <strong className="font-bold">trong khảo sát này</strong>:
          </p>
          <div className="mt-5">
            <RecordedList />
          </div>
          <div className="mt-5">
            <NeverRecordedNote />
          </div>
          <div className="mt-[19px]">
            <PurposeParagraph />
          </div>
          {errorAlert ? <div className="mt-4">{errorAlert}</div> : null}
          <div className="mt-[21px] flex items-center gap-3 border-t border-line-subtle pt-4">
            <p className="mr-auto text-[12px] text-ink-muted">
              Thông báo phiên bản {start.noticeVersion} ·{" "}
              <button type="button" onClick={() => setNoticeOpen(true)} className="font-bold text-primary hover:underline">
                Đọc đầy đủ
              </button>
            </p>
            <Button variant="secondary" size="lg" radius="field" className="px-5.5" onClick={decline} disabled={start.busy}>
              Không đồng ý
            </Button>
            <Button
              size="lg"
              radius="field"
              className="w-[230px]"
              onClick={start.accept}
              loading={start.busy}
              loadingLabel="Đang mở…"
            >
              Đồng ý và bắt đầu
              {start.busy ? null : <Icon name="arrow-right" size={18} className="ml-2.5 align-[-3px]" />}
            </Button>
          </div>
        </section>
      </main>

      {/* Mobile — content + sticky footer. */}
      <main className="flex flex-1 flex-col lg:hidden">
        <div className="flex flex-col px-5 pt-[18px] pb-8">
          <section className="flex flex-col gap-1.5 rounded-2xl border border-line bg-surface px-4 pt-3 pb-3.5">
            <h2 className="text-lead font-extrabold leading-[21.6px] text-ink">{title}</h2>
            <SurveyMeta effort={effort} reward={reward} />
          </section>
          <div className="mt-5 flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-field bg-tone-amber-bg text-tone-amber-fg">
              <Icon name="shield-check" size={22} />
            </span>
            <h1 className="-mt-1 text-[20px] font-extrabold leading-[26px] text-ink">
              Rescom ghi lại một số tương tác để đánh giá công bằng
            </h1>
          </div>
          <div className="mt-4">
            <RecordedList />
          </div>
          <div className="mt-4">
            <NeverRecordedNote />
          </div>
          <div className="mt-[15px]">
            <PurposeParagraph />
          </div>
          <button
            type="button"
            onClick={() => setNoticeOpen(true)}
            className="mt-7 self-start text-label font-bold text-primary hover:underline"
          >
            Đọc thông báo đầy đủ
          </button>
          {errorAlert ? <div className="mt-4">{errorAlert}</div> : null}
        </div>
        <div className="sticky bottom-0 mt-auto flex flex-col gap-2 border-t border-line bg-surface px-5 pt-3 pb-[max(env(safe-area-inset-bottom),12px)]">
          <Button size="lg" radius="field" fullWidth onClick={start.accept} loading={start.busy} loadingLabel="Đang mở…">
            Đồng ý và bắt đầu
          </Button>
          <Button variant="secondary" size="base" radius="field" fullWidth onClick={decline} disabled={start.busy}>
            Không đồng ý
          </Button>
          <p className="text-center text-[12px] text-ink-muted">
            Thông báo phiên bản {start.noticeVersion} · áp dụng cho khảo sát tạo trong Rescom
          </p>
        </div>
      </main>

      <Dialog open={noticeOpen} onClose={() => setNoticeOpen(false)} labelledBy="full-notice-title" width={600}>
        <div className="flex flex-col gap-4 p-6 lg:p-8">
          <h2 id="full-notice-title" className="text-[20px] font-extrabold text-ink">
            Thông báo dữ liệu chất lượng
          </h2>
          <FullNoticeBody version={start.noticeVersion} />
          <Button variant="secondary" size="base" radius="field" className="self-end" onClick={() => setNoticeOpen(false)}>
            Đã hiểu
          </Button>
        </div>
      </Dialog>
    </>
  );
}
