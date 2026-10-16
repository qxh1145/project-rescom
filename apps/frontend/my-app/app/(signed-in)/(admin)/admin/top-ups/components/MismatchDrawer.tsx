"use client";
import { useRef, useState, type ReactNode } from "react";
import type { AdminPayosMismatch } from "@rescom/schemas";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { TopUpStatusChip } from "@/components/wallet/TopUpStatusChip";
import { topUpChip } from "@/lib/wallet/top-up-history";
import { formatShortDateTime, vietnamDateTimeParts } from "@/lib/format/date-time";
import { formatVnd } from "@/lib/wallet/top-up";
import { diffVnd, mismatchPreview, mismatchSla, noteState } from "@/lib/admin/payos-top-up-mismatch";

export function MismatchDrawer({ item, busy, onClose, onSubmit, children }: { item: AdminPayosMismatch | null; busy: boolean; onClose: () => void; onSubmit: (action: "CREDIT" | "MANUAL_REFUND", note: string) => Promise<void>; children?: ReactNode }) {
  const [action, setAction] = useState<"CREDIT" | "MANUAL_REFUND">("CREDIT");
  const [note, setNote] = useState("");
  const submitting = useRef(false);
  if (!item) return null;
  const preview = mismatchPreview(item.amountPaidVnd ?? 0);
  const sla = mismatchSla(item);
  const due = vietnamDateTimeParts(item.resolveDueAt);
  const difference = diffVnd(item);
  // Below 1 Point the credit option is disabled, so refund is the only choice.
  const choice = preview.canCredit ? action : "MANUAL_REFUND";
  async function submit() {
    if (submitting.current || busy || (choice === "CREDIT" ? !preview.canCredit : !noteState(note).valid)) return;
    submitting.current = true;
    try { await onSubmit(choice, noteState(note).value); } finally { submitting.current = false; }
  }
  return <Dialog open onClose={onClose} labelledBy="mismatch-drawer-title" dismissible={!busy} width={560} className="ml-auto mr-0 h-dvh max-h-dvh rounded-none p-5 max-sm:w-full sm:p-6">
    <div className="flex items-start justify-between gap-3"><h2 id="mismatch-drawer-title" className="text-lg font-bold">Giao dịch #{item.orderCode}</h2><button type="button" disabled={busy} onClick={onClose} aria-label="Đóng">✕</button></div>
    <div className="mt-3 flex flex-wrap items-center gap-2"><TopUpStatusChip chip={topUpChip(item.status, "PAYOS")} /><span className="rounded-full bg-tone-amber-bg px-2 py-1 text-xs font-bold">Sai số tiền</span><span className={`rounded-full px-2 py-1 text-xs ${sla.overdue ? "bg-danger-soft text-danger" : "bg-surface-subtle"}`}>{sla.line}</span></div>
    <p className="mt-3 break-all text-sm text-ink-muted">{item.userEmail ?? "Người dùng"}{item.paidAt ? ` · thanh toán ${formatShortDateTime(item.paidAt)}` : ""}</p>
    <p className="mt-4 rounded-lg bg-surface-subtle p-3 text-sm">Hạn: 3 ngày làm việc kể từ lúc nhận tiền · {due ? `${due.day}/${due.month}/${due.year} ${due.hour}:${due.minute}` : "—"} ({sla.overdue ? sla.line : sla.line.toLowerCase()})</p>
    <div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div className="min-w-0 rounded-lg bg-surface-subtle p-3">Yêu cầu<strong className="block">{formatVnd(item.amountVnd)}</strong>{item.points} Điểm</div><div className="min-w-0 rounded-lg bg-tone-amber-bg p-3">Thực nhận<strong className="block">{formatVnd(item.amountPaidVnd ?? 0)}</strong>Chênh {difference > 0 ? "+" : ""}{formatVnd(difference)}</div></div>
    <dl className="my-4 divide-y divide-line text-sm">{[["Mã PayOS", item.providerReference ?? "—"], ["Tài khoản người trả", item.counterAccountBankName && item.counterAccountLast4 ? `${item.counterAccountBankName} · •••• ${item.counterAccountLast4}` : "Chưa có thông tin"], ["Nội dung CK", item.transferContent]].map(([label, value]) => <div key={label} className="flex justify-between gap-3 py-2"><dt className="text-ink-muted">{label}</dt><dd className="min-w-0 break-all text-right">{value}</dd></div>)}</dl>
    <fieldset disabled={busy} className="space-y-3"><legend className="mb-3 text-xs font-bold">CÁCH XỬ LÝ</legend>
      <label className={`block rounded-lg border p-3 ${choice === "CREDIT" ? "border-primary bg-tone-teal-bg" : "border-line"}`}><span className="flex gap-2"><input type="radio" name="resolution" disabled={!preview.canCredit} checked={choice === "CREDIT"} onChange={() => setAction("CREDIT")} /><strong>Cộng Điểm theo số thực nhận</strong></span><span className="mt-2 block text-sm">Cộng floor({formatVnd(item.amountPaidVnd ?? 0)} ÷ 200) = {preview.points} Điểm vào Khả dụng. Giao dịch chuyển sang Thành công.</span><span className="mt-2 block text-sm font-bold">User sẽ nhận {preview.points} Điểm</span>{!preview.canCredit && <span className="block text-sm text-danger">Số tiền thực nhận chưa đủ 1 Điểm.</span>}</label>
      <label className={`block rounded-lg border p-3 ${choice === "MANUAL_REFUND" ? "border-primary bg-tone-teal-bg" : "border-line"}`}><span className="flex gap-2"><input type="radio" name="resolution" checked={choice === "MANUAL_REFUND"} onChange={() => setAction("MANUAL_REFUND")} /><strong>Đã hoàn tiền thủ công</strong></span><span className="mt-2 block text-sm">Bạn đã trả lại {formatVnd(item.amountPaidVnd ?? 0)} ngoài hệ thống. Không cộng Điểm; giao dịch đóng lại.</span>{choice === "MANUAL_REFUND" && <span className="mt-3 block text-sm">Ghi chú * bắt buộc<textarea aria-label="Ghi chú bắt buộc" className="mt-1 block w-full rounded-lg border border-line p-2" rows={3} maxLength={500} value={note} onChange={event => setNote(event.target.value)} /></span>}</label>
    </fieldset>
    <div className="mt-5 flex items-center justify-end gap-3"><button type="button" disabled={busy} onClick={onClose}>Để sau</button><Button type="button" disabled={busy || (choice === "CREDIT" ? !preview.canCredit : !noteState(note).valid)} onClick={() => void submit()}>{busy ? "Đang xử lý…" : choice === "CREDIT" ? `Cộng ${preview.points} Điểm` : "Xác nhận đã hoàn tiền"}</Button></div>
    {children}
  </Dialog>;
}
