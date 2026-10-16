"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AdminPayosMismatch, AdminPayosUncredited } from "@rescom/schemas";
import { Button } from "@/components/ui/Button";
import { CodeIssueToasts, type CodeIssueToast } from "@/components/ui/Toasts";
import { formatShortDateTime, formatTime } from "@/lib/format/date-time";
import { formatVnd } from "@/lib/wallet/top-up";
import { recheckToast } from "@/lib/admin/payos-top-up-admin";
import { getAdminTopUpActionRequired, recheckPayosTopUp, resolveTopUpMismatch } from "@/lib/admin/payos-top-up-admin-service";
import { payosAdminErrorMessage } from "@/lib/admin/payos-top-up-admin-messages";
import { diffVnd, mismatchPreview, mismatchSla, resolveToast, uncreditedBanner } from "@/lib/admin/payos-top-up-mismatch";
import { isApiError } from "@/lib/api/api-error";
import { MismatchDrawer } from "./MismatchDrawer";

export function ActionRequiredPanel({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<{ uncredited: AdminPayosUncredited[]; mismatches: AdminPayosMismatch[] }>({ uncredited: [], mismatches: [] });
  const [selected, setSelected] = useState<AdminPayosMismatch | null>(null);
  const [loading, setLoading] = useState(true), [errorAt, setErrorAt] = useState<Date | null>(null);
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [toasts, setToasts] = useState<CodeIssueToast[]>([]);
  const toast = useCallback((title: string, body: string, tone: CodeIssueToast["tone"]) => setToasts(old => [...old, { id: Date.now() + Math.random(), title, body, tone }]), []);
  const dismiss = useCallback((id: number) => setToasts(old => old.filter(item => item.id !== id)), []);
  const reload = () => { setRevision(n => n + 1); onChanged(); };
  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => { if (!controller.signal.aborted) { setLoading(true); setErrorAt(null); } });
    getAdminTopUpActionRequired(controller.signal).then(data => {
      if (!controller.signal.aborted) { setItems(data); setSelected(old => data.mismatches.find(row => row.id === old?.id) ?? null); }
    }).catch(() => { if (!controller.signal.aborted) setErrorAt(new Date()); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);
  async function recheck(id: string) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { const message = recheckToast(await recheckPayosTopUp(id)); toast(message.title, message.body, message.tone); reload(); }
    catch (error) { toast("Không thể đồng bộ", payosAdminErrorMessage(error), "error"); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function resolve(action: "CREDIT" | "MANUAL_REFUND", note: string) {
    if (!selected || selected.amountPaidVnd === null || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const message = resolveToast(await resolveTopUpMismatch(selected.id, action === "CREDIT" ? { action, expectedAmountPaidVnd: selected.amountPaidVnd } : { action, expectedAmountPaidVnd: selected.amountPaidVnd, note }));
      toast(message.title, message.body, message.tone); setSelected(null); reload();
    } catch (error) {
      if (isApiError(error) && error.code === "TOPUP_MISMATCH_ALREADY_RESOLVED") { setSelected(null); reload(); }
      if (isApiError(error) && error.code === "TOPUP_MISMATCH_AMOUNT_CHANGED") reload();
      toast("Không thể xử lý", payosAdminErrorMessage(error), "error");
    } finally { busyRef.current = false; setBusy(false); }
  }
  const now = new Date();
  const banner = uncreditedBanner(items.uncredited, now);
  return <section className="min-w-0 rounded-card border border-line bg-surface p-4 sm:p-6">
    <h2 className="text-lg font-bold">Cần xử lý</h2>
    {errorAt ? <div role="alert" className="py-12 text-center"><h3 className="font-bold">Không tải được danh sách giao dịch</h3><Button type="button" onClick={reload}>Thử lại</Button><p className="text-xs text-ink-muted">Mã lỗi: TOPUPS_LOAD_FAILED · {formatShortDateTime(errorAt)}</p></div>
      : loading ? <div aria-busy="true" aria-label="Đang tải giao dịch" className="space-y-3 py-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-subtle" />)}</div>
      : items.uncredited.length + items.mismatches.length === 0 ? <p className="py-12 text-center text-ink-muted">Không có giao dịch cần xử lý</p> : <>
        {items.uncredited.length > 0 && <div role="alert" className="my-4 rounded-lg border border-danger bg-danger-soft p-4 text-sm text-danger"><strong>{banner.title}</strong>{banner.lines.map((line, i) => <p key={i} className="mt-1">{line}</p>)}</div>}
        <div className="hidden overflow-x-auto md:block"><table className="w-full text-left text-sm"><thead><tr>{["Loại", "Giao dịch", "Người dùng", "Yêu cầu / thực nhận", "Hạn xử lý", ""].map(head => <th scope="col" key={head} className="px-2 py-3">{head}</th>)}</tr></thead><tbody>
          {items.uncredited.map(row => <tr key={row.topUpId} className="border-t border-line bg-danger-soft/50"><td className="px-2 py-3">Chưa cộng Điểm &gt; 30 phút<br />Đã thanh toán {formatTime(row.paidAt)}</td><td className="px-2 py-3">#{row.orderCode}</td><td className="break-all px-2 py-3">{row.userEmail ?? "—"}</td><td className="px-2 py-3">{formatVnd(row.amountVnd)}</td><td className="px-2 py-3 text-danger">Xử lý ngay<br />Cảnh báo sau 30 phút</td><td><Button type="button" variant="outline" disabled={busy} onClick={() => void recheck(row.topUpId)}>Đồng bộ lại</Button></td></tr>)}
          {items.mismatches.map(row => { const sla = mismatchSla(row, now), diff = diffVnd(row); return <tr key={row.id} className={`border-t border-line ${sla.overdue ? "bg-danger-soft/50" : ""}`}><td className="px-2 py-3"><span className="rounded-full bg-tone-amber-bg p-1">Sai số tiền</span><span className="block">Chênh {diff > 0 ? "+" : ""}{formatVnd(diff)}</span></td><td className="px-2 py-3">#{row.orderCode}</td><td className="break-all px-2 py-3">{row.userEmail ?? "—"}</td><td className="px-2 py-3">{formatVnd(row.amountVnd)} / {formatVnd(row.amountPaidVnd ?? 0)}<span className="block text-xs">Nếu cộng theo thực nhận: {mismatchPreview(row.amountPaidVnd ?? 0).points} Điểm</span></td><td className="px-2 py-3"><strong className={sla.overdue ? "rounded-full bg-danger-soft px-2 py-0.5 text-xs text-danger" : "text-tone-amber-ink"}>{sla.line}</strong><span className="block">{sla.dueLabel}</span></td><td><Button type="button" disabled={busy} onClick={() => setSelected(row)}>Xử lý</Button></td></tr>; })}
        </tbody></table></div>
        <div className="space-y-3 md:hidden">{items.uncredited.map(row => <article key={row.topUpId} className="min-w-0 rounded-lg border border-danger bg-danger-soft p-3 text-sm"><strong>Chưa cộng Điểm &gt; 30 phút · #{row.orderCode}</strong><p className="break-all">{row.userEmail}</p><p>Đã thanh toán {formatTime(row.paidAt)} · Xử lý ngay</p><Button type="button" variant="outline" disabled={busy} onClick={() => void recheck(row.topUpId)}>Đồng bộ lại</Button></article>)}{items.mismatches.map(row => { const sla = mismatchSla(row, now); return <article key={row.id} className={`min-w-0 rounded-lg border p-3 text-sm ${sla.overdue ? "border-danger bg-danger-soft" : "border-line"}`}><strong>Sai số tiền · #{row.orderCode}</strong><p className="break-all">{row.userEmail}</p><p>{formatVnd(row.amountVnd)} / {formatVnd(row.amountPaidVnd ?? 0)} · {mismatchPreview(row.amountPaidVnd ?? 0).points} Điểm</p><p>{sla.line} · {sla.dueLabel}</p><Button type="button" disabled={busy} onClick={() => setSelected(row)}>Xử lý</Button></article>; })}</div>
        <p className="mt-4 text-xs text-ink-muted">Hạn xử lý giao dịch sai số tiền: 3 ngày làm việc kể từ lúc nhận tiền.</p>
      </>}
    <MismatchDrawer key={selected?.id ?? "none"} item={selected} busy={busy} onClose={() => setSelected(null)} onSubmit={resolve}><CodeIssueToasts items={toasts} dismiss={dismiss} /></MismatchDrawer>
    {!selected && <CodeIssueToasts items={toasts} dismiss={dismiss} />}
  </section>;
}
