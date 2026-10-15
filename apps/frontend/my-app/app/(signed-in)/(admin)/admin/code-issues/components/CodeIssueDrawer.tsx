"use client";
import { useState } from "react";
import Link from "next/link";
import type { AdminCodeIssueDto, AdminResolveCodeIssueDto } from "@rescom/schemas";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { Tag } from "@/components/ui/Tag";
import { formatShortDateTime } from "@/lib/format/date-time";
import { openSlaView, resolvedSlaView, reportStatusView, ticketStatusView, CODE_ISSUE_ADMIN_REASON_LABELS, PRICE_SOURCE_LABELS, REPLACE_BLOCKED_COPY } from "@/lib/admin/rewards-code-issues-view";
import { useAdminCodeIssue } from "../hooks/use-admin-code-issues";
import { ResolveCodeIssueDialog } from "./ResolveCodeIssueDialog";

type Outcome = AdminResolveCodeIssueDto["outcome"];
export function CodeIssueDrawer({ row, nowMs, onClose, onSuccess, onReload }: { row: AdminCodeIssueDto; nowMs: number; onClose: () => void; onSuccess: (outcome: Outcome) => void; onReload: () => void }) {
  const detail = useAdminCodeIssue(row.id);
  const issue = detail.data ?? row;
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [copied, setCopied] = useState(false);
  const status = reportStatusView(issue.status);
  const ticket = ticketStatusView(issue.ticketStatus);
  const sla = issue.status === "OPEN" ? openSlaView(issue, nowMs) : null;
  const blocked = issue.replaceBlockedReason ? REPLACE_BLOCKED_COPY[issue.replaceBlockedReason] : null;
  return <><Dialog open onClose={onClose} labelledBy="code-issue-drawer-title" width={560} className="lg:mr-0 lg:my-0 lg:h-dvh lg:max-h-dvh lg:rounded-r-none">
    <div className="flex h-full flex-col"><header className="flex items-start justify-between border-b border-line p-6"><div><h2 id="code-issue-drawer-title" className="text-xl font-extrabold">{issue.reference}</h2><div className="mt-2 flex gap-2"><Tag tone={status.tone}>{status.label}</Tag>{sla?.overdue && <Tag tone="danger">{sla.line}</Tag>}</div><p className="mt-2 text-body-sm text-ink-muted">Gửi {formatShortDateTime(issue.createdAt)} · user {issue.userLabel}</p></div><IconButton icon="x" label="Đóng" onClick={onClose} /></header>
      <div className="grid flex-1 content-start gap-5 overflow-y-auto p-6 text-body-sm">
        {detail.error && <Alert tone="danger">{detail.error.status === 404 ? "Không tìm thấy báo cáo" : "Không tải được chi tiết báo cáo"} <button type="button" className="font-bold underline" onClick={() => { if (detail.error?.status === 404) { onClose(); onReload(); } else detail.reload(); }}>{detail.error.status === 404 ? "Tải lại danh sách" : "Thử lại"}</button></Alert>}
        {sla && <section className={`rounded-field p-4 ${sla.overdue ? "bg-danger-soft text-danger-strong" : "bg-info-soft"}`}><strong>{sla.line} · hạn xử lý {formatShortDateTime(sla.dueAt)}</strong><p>Mục tiêu 1 ngày làm việc kể từ lúc gửi. Báo cáo gửi ngoài giờ được tính từ 08:00 ngày làm việc kế tiếp.</p></section>}
        <section className="rounded-field border border-line p-4"><h3 className="font-bold">{issue.voucher.title}</h3><p>{issue.voucher.brand.name} {issue.priceSource === "FLASH" && <Tag tone="amber">Flash Sale</Tag>}</p></section>
        <section className="grid gap-2"><h3 className="font-bold uppercase">Thông tin đổi điểm</h3><p>Mã tham chiếu: {issue.reference} <IconButton icon="copy" iconSize={16} label="Sao chép mã tham chiếu" onClick={() => void navigator.clipboard?.writeText(issue.reference).then(() => setCopied(true), () => setCopied(false))} /><span role="status" className="text-ink-muted">{copied ? "Đã sao chép" : ""}</span></p><p>Loại giá: {PRICE_SOURCE_LABELS[issue.priceSource]} · Đã trừ {issue.pricePoints} điểm</p><p>Ticket: <Tag tone={ticket.tone}>{ticket.label}</Tag></p><p className="flex items-center gap-1">Mã voucher: <Icon name="lock" size={16} /> Đã ẩn · Không hiển thị giá trị mã với Admin</p></section>
        <section className="grid gap-2"><h3 className="font-bold uppercase">Báo cáo của user</h3><p>Lý do: {CODE_ISSUE_ADMIN_REASON_LABELS[issue.reason]} <Tag>{issue.reason}</Tag></p><p className="rounded-field bg-surface-subtle p-3">Ghi chú của user: {issue.note ? `“${issue.note}”` : "User không để lại ghi chú."}</p></section>
        {issue.status === "OPEN" ? issue.canReplace ? <p className="rounded-field bg-tone-green-bg p-4 font-bold text-tone-green-fg">Có thể thay mã</p> : <section id="code-issue-replace-blocked" className="rounded-field bg-danger-soft p-4 text-danger"><strong>Không thể thay mã</strong><p>{blocked}</p><p>{issue.replaceBlockedReason === "NO_CODE" || issue.replaceBlockedReason === "NO_STOCK" ? "Nhập thêm mã ở Quản lý voucher, hoặc hoàn điểm cho user." : "Hãy hoàn điểm hoặc từ chối kèm hướng dẫn."}</p>{(issue.replaceBlockedReason === "NO_CODE" || issue.replaceBlockedReason === "NO_STOCK") && <Link className="font-bold underline" href={`/admin/vouchers/${issue.voucher.id}`}>Mở Quản lý voucher ›</Link>}</section> : <section className="grid gap-2"><Alert tone="info">Đã xử lý · chỉ xem. Không còn thao tác Thay mã / Hoàn điểm / Từ chối.</Alert><h3 className="font-bold uppercase">Kết quả xử lý</h3><p>Kết quả: {status.label}</p><p>Người xử lý: {issue.resolvedBy?.name}</p><p>Thời điểm: {issue.resolvedAt && formatShortDateTime(issue.resolvedAt)}</p><p>Xử lý sau {resolvedSlaView(issue).took} · {resolvedSlaView(issue).late ?? "trong hạn 1 ngày làm việc"}</p>{issue.status === "REFUNDED" && <p>Mã hoàn điểm: {issue.resolution?.refundReference} · Hoàn {issue.pricePoints} điểm về ví Khả dụng</p>}{issue.status === "REPLACED" && <p>Mã mới: Đã ẩn</p>}{issue.resolutionNote && <p>{issue.status === "REJECTED" ? "Ghi chú gửi user" : "Ghi chú nội bộ"}: “{issue.resolutionNote}”</p>}</section>}
      </div>
      {issue.status === "OPEN" && <footer className="flex flex-wrap justify-end gap-2 border-t border-line p-5"><Button size="base" variant="ghost" disabled={detail.loading || !!detail.error} onClick={() => setOutcome("REJECT")}>Từ chối</Button><Button size="base" variant="outline" leadingIcon={<Icon name="refund" size={18} />} disabled={detail.loading || !!detail.error} onClick={() => setOutcome("REFUND")}>Hoàn {issue.pricePoints} điểm</Button><Button size="base" leadingIcon={<Icon name="refresh" size={18} />} disabled={detail.loading || !!detail.error || !issue.canReplace} title={blocked ?? undefined} aria-describedby={!issue.canReplace ? "code-issue-replace-blocked" : undefined} onClick={() => setOutcome("REPLACE")}>Thay mã</Button></footer>}
    </div>
  </Dialog>{outcome && <ResolveCodeIssueDialog key={outcome} issue={issue} outcome={outcome} onClose={() => setOutcome(null)} onSuccess={() => { setOutcome(null); onSuccess(outcome); }} onResult={() => { setOutcome(null); detail.reload(); onReload(); }} onMissing={() => { setOutcome(null); onClose(); onReload(); }} onSwitch={setOutcome} />}</>;
}
