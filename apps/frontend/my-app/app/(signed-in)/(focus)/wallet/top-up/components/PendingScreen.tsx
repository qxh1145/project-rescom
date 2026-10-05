"use client";

import Link from "next/link";
import type { TopUpStatus } from "@rescom/schemas";
import { FocusError, FocusLoading } from "@/app/(signed-in)/(focus)/_participation/FocusPageState";
import { Mascot, type MascotName } from "@/components/brand/Mascot";
import { buttonClassName } from "@/components/ui/Button";
import { Icon, type IconName } from "@/components/ui/Icon";
import { formatDayMonth, formatTime } from "@/lib/format/date-time";
import { formatPoints, formatVnd, topUpTimeline } from "@/lib/wallet/top-up";
import { loadTopUpErrorMessage } from "@/lib/wallet/wallet-messages";
import { useTopUpRequest } from "../hooks/use-top-up-request";
import { StatusTimeline } from "./StatusTimeline";
import { TopUpFrame } from "./TopUpFrame";

/** Figma 14c draws PENDING only; APPROVED / REJECTED copy, pill and mascot are ASSUMED (design). */
const STATUS: Record<TopUpStatus, { pill: string; icon: IconName; pillClass: string; mascot: MascotName }> = {
  PENDING: { pill: "Đang chờ duyệt", icon: "hourglass", pillClass: "bg-tone-amber-bg text-tone-amber-fg", mascot: "wait" },
  APPROVED: { pill: "Đã duyệt", icon: "check", pillClass: "bg-tone-teal-bg text-tone-teal-fg", mascot: "points" },
  REJECTED: { pill: "Bị từ chối", icon: "x", pillClass: "bg-danger-soft text-danger", mascot: "sad" },
};

function titleOf(status: TopUpStatus, points: string): string {
  if (status === "APPROVED") return `Đã nạp ${points} điểm`;
  if (status === "REJECTED") return `Yêu cầu nạp ${points} điểm bị từ chối`;
  return `Đã gửi yêu cầu nạp ${points} điểm`;
}

function StatusPill({ status }: { status: TopUpStatus }) {
  const view = STATUS[status];
  return (
    <span className={`inline-flex h-7.5 items-center gap-1.5 rounded-full px-3 text-caption font-bold ${view.pillClass}`}>
      <Icon name={view.icon} size={14} />
      {view.pill}
    </span>
  );
}

/**
 * Figma 14c "Nạp điểm · chờ duyệt" — desktop dialog 62:2968 (600px, mascot
 * right of the steps), mobile 62:3154 (mascot, centered heading, steps card).
 */
export function PendingScreen() {
  const { request, error, reload } = useTopUpRequest();

  if (error && !request) {
    return (
      <FocusError
        title="Chưa mở được yêu cầu nạp"
        message={loadTopUpErrorMessage(error)}
        onRetry={reload}
        backHref="/wallet"
        backLabel="Về Ví điểm"
      />
    );
  }
  if (!request) return <FocusLoading />;

  const points = formatPoints(request.amount);
  const title = titleOf(request.status, points);
  const sent = `${formatDayMonth(request.createdAt)} · ${formatTime(request.createdAt)}`;
  const steps = topUpTimeline(request, `${sent} · ${request.transferReference}`);
  const summary = `${formatVnd(request.amountVnd)} · nội dung ${request.transferReference}`;
  const view = STATUS[request.status];

  return (
    <TopUpFrame
      mobileTitle="Yêu cầu nạp điểm"
      exitHref="/wallet"
      width={600}
      desktopHeader={
        <>
          <StatusPill status={request.status} />
          <h1 id="top-up-dialog-title" className="mt-2 text-[22px] font-extrabold text-ink">
            {title}
          </h1>
          <p className="mt-1.5 text-body-sm text-ink-muted">{summary}</p>
        </>
      }
      mobileFooter={
        <Link href="/wallet" className={buttonClassName({ variant: "secondary", size: "lg", radius: "field", fullWidth: true })}>
          Về Ví điểm
        </Link>
      }
    >
      <div className="flex flex-col items-center text-center lg:hidden">
        <Mascot name={view.mascot} height={110} className="mt-1" />
        <div className="mt-2">
          <StatusPill status={request.status} />
        </div>
        <h2 className="mt-2 text-[22px] font-extrabold text-ink">{title}</h2>
        <p className="mt-1.5 text-body-sm text-ink-muted">Số tiền {summary}</p>
      </div>

      <div className="mt-5 flex items-center gap-6 rounded-[18px] border border-line bg-surface p-[18px] lg:mt-[18px] lg:rounded-none lg:border-0 lg:p-0">
        <div className="min-w-0 flex-1">
          <StatusTimeline steps={steps} />
        </div>
        <Mascot name={view.mascot} height={140} className="hidden shrink-0 lg:mr-1.5 lg:block" />
      </div>

      <p className="mt-5 text-caption-relaxed text-ink-muted lg:hidden">
        {request.status === "REJECTED"
          ? "Nếu bạn đã chuyển khoản, hãy liên hệ hỗ trợ kèm nội dung chuyển khoản để được đối chiếu lại."
          : "Nếu Admin không tìm thấy giao dịch khớp, bạn nhận thông báo kèm lý do. Nạp điểm là một chiều, không hoàn tiền."}
      </p>

      <div className="mt-9 hidden justify-end border-t border-line-subtle pt-4 lg:flex">
        <Link href="/wallet" className={buttonClassName({ size: "base", radius: "field" })}>
          Về Ví điểm
        </Link>
      </div>
    </TopUpFrame>
  );
}
