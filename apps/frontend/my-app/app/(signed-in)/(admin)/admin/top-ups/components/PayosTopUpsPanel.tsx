"use client";
import { Fragment, useCallback, useEffect, useState } from "react";
import type { AdminPayosTopUp, PayosTopUpStatus } from "@rescom/schemas";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Mascot } from "@/components/brand/Mascot";
import { TopUpStatusChip } from "@/components/wallet/TopUpStatusChip";
import { CodeIssueToasts, type CodeIssueToast } from "@/components/ui/Toasts";
import { formatShortDateTime } from "@/lib/format/date-time";
import { formatVnd } from "@/lib/wallet/top-up";
import { topUpChip } from "@/lib/wallet/top-up-history";
import { requesterName } from "@/lib/admin/top-up-admin";
import { defaultDateRange, toListQuery, recheckToast, payosStatusOptions, ADMIN_PAYOS_PAGE_SIZE, type PayosFilters } from "@/lib/admin/payos-top-up-admin";
import { listAdminPayosTopUps, recheckPayosTopUp, exportPayosTopUps } from "@/lib/admin/payos-top-up-admin-service";
import { payosAdminErrorMessage } from "@/lib/admin/payos-top-up-admin-messages";
import { PayosTopUpDrawer } from "./PayosTopUpDrawer";

export function PayosTopUpsPanel({ onChanged }: { onChanged: () => void }) {
  const [filters, setFilters] = useState<PayosFilters>(() => ({ ...defaultDateRange(), q: "" }));
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AdminPayosTopUp[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorAt, setErrorAt] = useState<Date | null>(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<AdminPayosTopUp | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toasts, setToasts] = useState<CodeIssueToast[]>([]);
  const toast = useCallback((title: string, body: string, tone: CodeIssueToast["tone"], action?: () => void, actionLabel?: string) => setToasts(prev => [...prev, { id: Date.now() + Math.random(), title, body, tone, action, actionLabel }]), []);
  const dismiss = useCallback((id: number) => setToasts(prev => prev.filter(item => item.id !== id)), []);
  function update(patch: Partial<PayosFilters>) { setFilters(old => ({ ...old, ...patch })); setPage(1); }
  useEffect(() => { if (search === filters.q) return; const timer = setTimeout(() => update({ q: search }), 300); return () => clearTimeout(timer); }, [search, filters.q]);
  const invalidRange = filters.from > filters.to;
  useEffect(() => {
    const controller = new AbortController();
    if (filters.from > filters.to) return;
    queueMicrotask(() => { if (!controller.signal.aborted) { setItems([]); setLoading(true); setErrorAt(null); } });
    listAdminPayosTopUps(toListQuery(filters, page), controller.signal)
      .then(data => { if (!controller.signal.aborted) { if (data.items.length === 0 && data.total > 0 && page > 1) { setPage(Math.ceil(data.total / ADMIN_PAYOS_PAGE_SIZE)); return; } setItems(data.items); setTotal(data.total); setSelected(old => data.items.find(item => item.id === old?.id) ?? null); } })
      .catch(() => { if (!controller.signal.aborted) setErrorAt(new Date()); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, page, retry]);
  async function recheck() {
    if (!selected || busy) return;
    setBusy(true);
    try {
      const result = await recheckPayosTopUp(selected.id);
      const message = recheckToast(result); toast(message.title, message.body, message.tone);
      setRetry(value => value + 1); onChanged();
    } catch (err) { toast("Không thể kiểm tra", payosAdminErrorMessage(err), "error", () => void recheck(), "Thử lại"); }
    finally { setBusy(false); }
  }
  async function exportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const { blob, fileName } = await exportPayosTopUps({ from: filters.from, to: filters.to });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = fileName ?? `rescom-payos-topups-${filters.from}-${filters.to}.csv`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { toast("Không thể xuất CSV", payosAdminErrorMessage(err), "error"); }
    finally { setExporting(false); }
  }
  const pages = Math.max(1, Math.ceil(total / ADMIN_PAYOS_PAGE_SIZE));
  // Figma pager: first, a 3-page window around the current page, last; gaps render as "…".
  const start = Math.max(1, Math.min(page - 1, pages - 2));
  const pageNumbers = [...new Set([1, start, start + 1, start + 2, pages])].filter(n => n >= 1 && n <= pages).sort((a, b) => a - b);
  const field = "h-11 rounded-lg border border-line-strong bg-surface px-3 text-sm";
  const pagerButton = "grid size-9 place-items-center rounded-lg border border-line text-sm disabled:opacity-40";
  return <section role="tabpanel" id="top-ups-payos-panel" aria-labelledby="top-ups-payos-tab" className="rounded-card bg-surface p-4 md:p-6">
    <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
      <label className="relative min-w-0 md:w-[280px]"><span className="sr-only">Tìm kiếm</span><span aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted"><Icon name="search" size={18} /></span><input type="search" placeholder="Tìm mã giao dịch hoặc email" value={search} onChange={e => setSearch(e.target.value)} className={`${field} w-full pl-10`} /></label>
      <label><span className="sr-only">Trạng thái</span><select value={filters.status ?? ""} onChange={e => update({ status: e.target.value ? e.target.value as PayosTopUpStatus : undefined })} className={`${field} w-full md:w-[180px]`}><option value="">Tất cả trạng thái</option>{payosStatusOptions().map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <div className="flex items-center gap-2"><input aria-label="Từ ngày" type="date" value={filters.from} max={filters.to} onChange={e => update({ from: e.target.value })} className={`${field} min-w-0 flex-1`} /><span aria-hidden className="text-ink-muted">–</span><input aria-label="Đến ngày" type="date" value={filters.to} min={filters.from} onChange={e => update({ to: e.target.value })} className={`${field} min-w-0 flex-1`} /></div>
      <div className="md:ml-auto"><Button type="button" variant="outline" size="md" fullWidth disabled={exporting || !filters.from || !filters.to || invalidRange} onClick={() => void exportCsv()}>{exporting ? "Đang xuất…" : "Xuất CSV"}</Button></div>
    </div>
    <div className="mt-5">
    {invalidRange ? <div role="alert" className="py-12 text-center"><h2 className="font-bold">Khoảng ngày không hợp lệ</h2><p className="text-sm text-ink-muted">“Từ ngày” phải trước hoặc bằng “Đến ngày”.</p></div> :
      errorAt ? <div role="alert" className="flex flex-col items-center gap-2 py-12 text-center"><Mascot name="offline" height={110} /><h2 className="mt-2 font-bold">Không tải được danh sách giao dịch</h2><p className="max-w-[320px] text-sm text-ink-muted">Kết nối tới máy chủ bị gián đoạn. Dữ liệu giao dịch không bị thay đổi.</p><Button type="button" size="md" onClick={() => setRetry(value => value + 1)}>Thử lại</Button><p className="text-xs text-ink-muted">Mã lỗi: TOPUPS_LOAD_FAILED · {formatShortDateTime(errorAt)}</p></div> :
      loading ? <div aria-busy="true" aria-label="Đang tải giao dịch" className="space-y-3">{Array.from({ length: 5 }, (_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-surface-subtle" />)}</div> :
      items.length === 0 ? <div className="py-12 text-center"><h2 className="font-bold">Không có giao dịch khớp bộ lọc</h2><p className="text-sm text-ink-muted">Thử đổi trạng thái, khoảng ngày hoặc từ khoá tìm kiếm.</p></div> : <>
      <table className="hidden w-full text-left text-sm md:table"><thead className="text-xs text-ink-muted"><tr>{[["Mã giao dịch", ""], ["Người dùng", ""], ["Số tiền", "text-right"], ["Điểm", ""], ["Trạng thái", ""], ["Thời gian", ""], ["", ""]].map(([label, align], i) => <th scope="col" key={i} className={`px-3 pb-3 font-medium ${align}`}>{label}</th>)}</tr></thead><tbody>{items.map(item => <tr key={item.id} className="border-t border-line hover:bg-surface-subtle"><td className="px-3 py-3"><button type="button" className="font-bold" onClick={() => setSelected(item)}>{item.orderCode}</button></td><td className="px-3 py-3"><strong className="block">{requesterName(item)}</strong><span className="text-xs text-ink-muted">{item.userEmail}</span></td><td className="px-3 py-3 text-right">{formatVnd(item.amountVnd)}</td><td className="px-3 py-3 font-bold">{item.points}</td><td className="px-3 py-3"><TopUpStatusChip chip={topUpChip(item.status, "PAYOS")} /></td><td className="px-3 py-3">{formatShortDateTime(item.createdAt)}</td><td className="text-right"><button aria-label={`Xem giao dịch ${item.orderCode}`} type="button" className="p-3" onClick={() => setSelected(item)}>›</button></td></tr>)}</tbody></table>
      <div className="space-y-3 md:hidden">{items.map(item => <button type="button" key={item.id} onClick={() => setSelected(item)} className="w-full min-w-0 rounded-lg border border-line p-4 text-left"><span className="flex justify-between"><strong>{item.orderCode}</strong><span aria-hidden>›</span></span><span className="block break-all text-sm text-ink-muted">{item.userEmail}</span><span className="mt-2 flex flex-wrap items-center justify-between gap-2"><span>{formatVnd(item.amountVnd)} · <strong>{item.points}</strong> Điểm</span><TopUpStatusChip chip={topUpChip(item.status, "PAYOS")} /></span><span className="block text-sm text-ink-muted">{formatShortDateTime(item.createdAt)}</span></button>)}</div>
      <nav aria-label="Phân trang giao dịch" className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-xs text-ink-muted"><span>Hiển thị {(page - 1) * ADMIN_PAYOS_PAGE_SIZE + 1}–{Math.min(page * ADMIN_PAYOS_PAGE_SIZE, total)} trong {total} giao dịch</span><div className="flex flex-wrap gap-1.5"><button type="button" aria-label="Trang trước" disabled={page === 1} className={pagerButton} onClick={() => setPage(page - 1)}>‹</button>{pageNumbers.map((n, i) => <Fragment key={n}>{i > 0 && n - pageNumbers[i - 1] > 1 && <span aria-hidden className={pagerButton}>…</span>}<button type="button" aria-label={`Trang ${n}`} aria-current={page === n ? "page" : undefined} className={`${pagerButton} text-ink aria-[current=page]:border-ink-strong aria-[current=page]:bg-ink-strong aria-[current=page]:text-surface`} onClick={() => setPage(n)}>{n}</button></Fragment>)}<button type="button" aria-label="Trang sau" disabled={page === pages} className={pagerButton} onClick={() => setPage(page + 1)}>›</button></div></nav></>}
    </div>
    <PayosTopUpDrawer item={selected} busy={busy} onClose={() => setSelected(null)} onRecheck={() => void recheck()}><CodeIssueToasts items={toasts} dismiss={dismiss} /></PayosTopUpDrawer>
    {!selected && <CodeIssueToasts items={toasts} dismiss={dismiss} />}
  </section>;
}
