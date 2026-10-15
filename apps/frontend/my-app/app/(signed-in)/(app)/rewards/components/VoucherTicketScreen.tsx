"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import type { CodeIssueReportDto } from "@rescom/schemas";
import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useApiQuery } from "@/lib/api/use-api-query";
import { isApiError } from "@/lib/api/api-error";
import { copyTextToClipboard, CLIPBOARD_COPY_FAILED_MESSAGE } from "@/lib/clipboard";
import { formatDayMonth, formatTime } from "@/lib/format/date-time";
import { canReportIssue, canUndo, codeIssueStatusView, ticketActionErrorMessage, undoLine, type ViewTone } from "@/lib/rewards/my-vouchers";
import { getMyVoucher, markVoucherUsed, undoVoucherUse } from "@/lib/rewards/rewards-service";
import { serverOffset } from "@/lib/rewards/server-clock";
import { brandTintClass, formatFullDate, formatVnd } from "@/lib/rewards/voucher-display";
import { useServerNow } from "../hooks/use-server-now";
import { CodeIssueSheet } from "./CodeIssueSheet";
import { RewardsErrorState } from "./RewardsErrorState";
import { VoucherQr } from "./VoucherQr";
import { VoucherThumb } from "./VoucherThumb";

const TONE_BOX: Record<ViewTone, string> = {
  green: "bg-tone-green-bg text-tone-green-fg", amber: "bg-tone-amber-bg text-tone-amber-fg", blue: "bg-tone-blue-bg text-tone-blue-fg",
  danger: "bg-danger-soft text-danger", neutral: "bg-surface-subtle text-ink",
};
const COPIED = "Đã sao chép mã";

export function VoucherTicketScreen({ ticketId }: { ticketId: string }) {
  const { data, error, reload, setData } = useApiQuery(`rewards-ticket:${ticketId}`, useCallback((signal) => getMyVoucher(ticketId, signal), [ticketId]));
  // Ticking server clock: the undo window closes while the page stays open.
  const serverTime = data?.serverTime;
  const offsetMs = useMemo(() => (serverTime ? serverOffset(serverTime) : 0), [serverTime]);
  const nowMs = useServerNow(offsetMs);
  const [acting, setActing] = useState<"use" | "undo" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [copyMessage, setCopyMessage] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const usedLine = useRef<HTMLParagraphElement>(null);
  const issueBox = useRef<HTMLDivElement>(null);
  const markButton = useRef<HTMLButtonElement>(null);
  const reportButton = useRef<HTMLButtonElement>(null);
  const focusLater = (target: { current: HTMLElement | null }) => setTimeout(() => target.current?.focus(), 0);

  if (!data) {
    if (!error) return <div className="mx-auto max-w-[480px] px-4 py-6" role="status" aria-label="Đang tải voucher"><div className="thought-skeleton h-[480px] rounded-[20px]" /></div>;
    return <div className="min-h-full pb-24"><MobileBackBar title="Dùng voucher" backHref="/rewards/my-vouchers" /><main className="mx-auto max-w-[480px] px-4">{error.status === 404
      ? <div className="py-12 text-center"><h2 className="text-title-sm font-bold text-ink">Không tìm thấy voucher</h2><ButtonLink href="/rewards/my-vouchers" size="base" className="mt-5">Về Voucher của tôi</ButtonLink></div>
      : <RewardsErrorState title="Chưa tải được voucher của bạn" onRetry={reload} />}</main></div>;
  }

  const { ticket } = data;
  const refunded = ticket.openIssue?.status === "REFUNDED";
  const expired = ticket.status === "EXPIRED";
  const inactive = expired || refunded;
  const issue = ticket.openIssue ? codeIssueStatusView(ticket.openIssue.status) : null;

  const run = async (kind: "use" | "undo") => {
    setActing(kind);
    setActionError(null);
    try {
      const next = await (kind === "use" ? markVoucherUsed : undoVoucherUse)(ticket.id);
      setData(() => next);
      setAnnounce(kind === "use" ? "Đã đánh dấu đã dùng" : "Đã hoàn tác");
      focusLater(kind === "use" ? usedLine : markButton);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setActionError(ticketActionErrorMessage(cause));
      if (isApiError(cause) && cause.status === 409) reload();
    } finally {
      setActing(null);
    }
  };
  const copy = () => void copyTextToClipboard(ticket.code).then((ok) => setCopyMessage(ok ? COPIED : CLIPBOARD_COPY_FAILED_MESSAGE));
  const closeSheet = () => { setSheetOpen(false); focusLater(reportButton); };
  const reported = (report: CodeIssueReportDto) => {
    setSheetOpen(false);
    setData((current) => current && { ...current, ticket: { ...current.ticket, openIssue: { id: report.id, status: report.status } } });
    reload();
    focusLater(issueBox);
  };

  return (
    <div className="min-h-full pb-24 lg:pb-12">
      <MobileBackBar title="Dùng voucher" backHref="/rewards/my-vouchers" />
      <main className="mx-auto max-w-[480px] px-4 py-4 lg:py-8">
        <div className="mb-4 hidden lg:block">
          <Link href="/rewards/my-vouchers" className="inline-flex items-center gap-1 text-label font-semibold text-primary"><Icon name="chevron-left" size={16} />Voucher của tôi</Link>
          <h1 className="mt-2 text-title font-extrabold text-ink">Dùng voucher</h1>
        </div>
        <section aria-label="Mã voucher" className="overflow-hidden rounded-[20px] border border-line bg-surface">
          <div className={`flex items-center gap-3 p-4 ${brandTintClass(ticket.brand.id, ticket.category)}`}>
            <VoucherThumb brand={ticket.brand} category={ticket.category} size="sm" />
            <div><p className="text-caption">{ticket.brand.name}</p><p className="font-extrabold text-ink">Voucher {formatVnd(ticket.valueVnd)}</p></div>
          </div>
          <div className="p-5 text-center">
            <VoucherQr code={ticket.code} dimmed={inactive} />
            <p className={`mt-4 select-all font-mono text-[24px] font-bold tracking-[0.12em] text-ink ${inactive ? "opacity-40" : ""}`}>{ticket.code}</p>
            {!inactive && <Button variant="outline" size="base" className="mt-3" onClick={copy} leadingIcon={<Icon name="copy" size={18} />}>Sao chép mã</Button>}
            <span className="sr-only" aria-live="polite">{copyMessage === COPIED ? COPIED : ""}</span>
            {copyMessage && copyMessage !== COPIED && <p role="alert" className="mt-2 text-caption text-danger">{copyMessage}</p>}
            {!inactive && <p className="mt-3 text-caption text-ink-muted">{ticket.isSharedCode ? "Mã dùng chung. " : ""}Dùng đến hết {formatFullDate(ticket.expiresAt)}.</p>}
            {expired && <p className="mt-3 rounded-[12px] bg-surface-subtle p-3 text-body-sm text-ink-muted">Voucher đã hết hạn ngày {formatFullDate(ticket.expiresAt)}. Voucher hết hạn không được hoàn điểm.</p>}
          </div>
        </section>
        {ticket.howToUse.length > 0 && <section aria-labelledby="how-to-use" className="mt-4 rounded-[20px] border border-line bg-surface p-5">
          <h2 id="how-to-use" className="font-extrabold text-ink">Cách dùng tại cửa hàng</h2>
          <ol className="mt-3 space-y-3">{ticket.howToUse.map((step, index) => <li key={step} className="flex gap-3 text-body-sm"><span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-tone-green-bg text-caption font-bold text-tone-green-fg">{index + 1}</span><span>{step}</span></li>)}</ol>
        </section>}
        {issue && <div ref={issueBox} tabIndex={-1} role="status" className={`mt-4 rounded-[16px] p-4 outline-none ${TONE_BOX[issue.tone]}`}><p className="font-bold">{issue.title}</p><p className="mt-1 text-body-sm">{issue.body}</p></div>}
        {!inactive && <div className="mt-4 flex flex-col items-center gap-2">
          {ticket.status === "USED" ? <>
            <p ref={usedLine} tabIndex={-1} className="w-full rounded-[14px] bg-surface-subtle p-3 text-center font-semibold text-ink outline-none">Đã dùng lúc {formatTime(ticket.usedAt)} {formatDayMonth(ticket.usedAt)}</p>
            {canUndo(ticket, nowMs) && <><Button variant="secondary" size="base" fullWidth loading={acting === "undo"} disabled={acting !== null} onClick={() => run("undo")}>Hoàn tác</Button><p className="text-caption text-ink-muted">{undoLine(ticket)}</p></>}
          </> : <Button ref={markButton} size="base" fullWidth loading={acting === "use"} disabled={acting !== null} onClick={() => run("use")} leadingIcon={<Icon name="check" size={18} />}>Đánh dấu đã dùng</Button>}
          {actionError && <p role="alert" className="text-body-sm text-danger">{actionError}</p>}
          {canReportIssue(ticket) && <Button ref={reportButton} variant="ghost" size="base" disabled={acting !== null} onClick={() => setSheetOpen(true)} leadingIcon={<Icon name="flag" size={18} />}>Báo mã lỗi</Button>}
        </div>}
        <p className="sr-only" role="status">{announce}</p>
        {!inactive && <p className="mt-4 text-center text-caption text-ink-muted">“Đánh dấu đã dùng” chỉ để bạn dễ theo dõi, có thể hoàn tác trong 24 giờ. Mã lỗi được Admin xử lý trong 1 ngày làm việc: đổi mã mới hoặc trả lại điểm.</p>}
      </main>
      <CodeIssueSheet ticketId={ticket.id} open={sheetOpen} onClose={closeSheet} onReported={reported} onReload={reload} />
    </div>
  );
}
