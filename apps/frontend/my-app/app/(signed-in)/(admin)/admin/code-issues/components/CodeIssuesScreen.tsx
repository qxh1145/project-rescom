"use client";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AdminCodeIssueDto, AdminCodeIssueStatusFilter, AdminResolveCodeIssueDto } from "@rescom/schemas";
import { AdminPage } from "@/components/layout/admin/AdminPage";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Tag } from "@/components/ui/Tag";
import { Mascot } from "@/components/brand/Mascot";
import { isApiError } from "@/lib/api/api-error";
import { CODE_ISSUE_ADMIN_REASON_LABELS, PRICE_SOURCE_LABELS, PAGE_SIZE, clampOffset, formatWait, openSlaView, pageCount, pageRangeText, reportStatusView, resolvedSlaView, successToast, tabLabel, ticketStatusView } from "@/lib/admin/rewards-code-issues-view";
import { useAdminCodeIssues } from "../hooks/use-admin-code-issues";
import { CodeIssueDrawer } from "./CodeIssueDrawer";
import { CodeIssueToasts, type CodeIssueToast } from "@/components/ui/Toasts";

const FILTERS: AdminCodeIssueStatusFilter[] = ["OPEN", "RESOLVED", "ALL"];
export function CodeIssuesScreen() {
  const [filter, setFilter] = useState<AdminCodeIssueStatusFilter>("OPEN");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AdminCodeIssueDto | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [toasts, setToasts] = useState<CodeIssueToast[]>([]);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // The drawer unmounts its <dialog> without close(), so the browser does not restore focus.
  const opener = useRef<HTMLButtonElement | null>(null);
  const query = useAdminCodeIssues(filter, offset);
  const list = query.data;
  const dismiss = useCallback((id: number) => setToasts(items => items.filter(item => item.id !== id)), []);
  const push = useCallback((toast: Omit<CodeIssueToast, "id">) => setToasts(items => [...items.slice(-2), { ...toast, id: Date.now() + Math.random() }]), []);
  useEffect(() => { if (!selected) opener.current?.focus(); }, [selected]);
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden) setNowMs(Date.now()); }, 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (list && offset > 0 && list.total <= offset) {
      const next = clampOffset(offset, list.total);
      queueMicrotask(() => setOffset(next));
    }
  }, [list, offset]);
  useEffect(() => {
    if (query.error && list) queueMicrotask(() => push({ tone: "error", title: "Không làm mới được danh sách", body: "Dữ liệu có thể đã cũ. Bấm để tải lại.", action: query.reload }));
    // Only notify once per failed request; callbacks intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.error]);
  function choose(next: AdminCodeIssueStatusFilter) { setFilter(next); setOffset(0); }
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = FILTERS.length - 1;
    const next = event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (next === null) return;
    event.preventDefault();
    choose(FILTERS[next]);
    tabRefs.current[next]?.focus();
  }
  function resolved(outcome: AdminResolveCodeIssueDto["outcome"]) {
    if (!selected) return;
    push({ tone: "success", ...successToast(outcome, selected) });
    // The resolved row leaves the OPEN list, so return focus to the tab instead.
    if (filter === "OPEN") opener.current = tabRefs.current[0];
    setSelected(null);
    if (filter === "OPEN" && list && list.items.length === 1 && offset) setOffset(clampOffset(offset, list.total - 1));
    else query.reload();
  }
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const pages = pageCount(list?.total ?? 0);
  return <AdminPage title="Báo cáo mã lỗi" meta="Mục tiêu xử lý: 1 ngày làm việc kể từ lúc gửi">
    <section className="mb-6 w-fit min-w-65 rounded-card border border-line bg-surface p-5"><p className="text-ink-muted">Đang mở</p><strong className="text-3xl">{list?.summary.open ?? "—"}</strong><p className="text-body-sm text-ink-muted">{list?.summary.oldestOpenAt ? `Cũ nhất: chờ ${formatWait(nowMs - Date.parse(list.summary.oldestOpenAt))}` : "Không có báo cáo chờ"}</p></section>
    <div role="tablist" aria-label="Trạng thái báo cáo" className="mb-5 flex gap-2 border-b border-line">{FILTERS.map((status, index) => <button key={status} ref={node => { tabRefs.current[index] = node; }} type="button" role="tab" tabIndex={filter === status ? 0 : -1} onKeyDown={event => onTabKey(event, index)} id={`code-issue-tab-${status}`} aria-controls="code-issues-panel" aria-selected={filter === status} className={`border-b-2 px-4 py-3 font-bold ${filter === status ? "border-primary text-primary" : "border-transparent text-ink-muted"}`} onClick={() => choose(status)}>{tabLabel(status, query.loading && !list ? null : list ?? null, filter)}</button>)}</div>
    <div id="code-issues-panel" role="tabpanel" aria-labelledby={`code-issue-tab-${filter}`} aria-busy={query.loading && !list}>
      {query.loading && !list ? <div role="status" className="grid gap-3" aria-label="Đang tải danh sách báo cáo">{Array.from({ length: 6 }, (_, i) => <div key={i} className="h-16 animate-pulse rounded-card bg-surface-subtle" />)}</div>
      : query.error && !list ? <section className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-10 text-center"><Mascot name="offline" height={120} /><h2 className="font-bold">Không tải được danh sách báo cáo</h2><p>Kết nối tới máy chủ bị gián đoạn. Dữ liệu báo cáo không bị thay đổi.</p><Button onClick={query.reload}>Thử lại</Button><p>Mã lỗi: {isApiError(query.error) ? query.error.code ?? "REPORTS_LOAD_FAILED" : "REPORTS_LOAD_FAILED"}</p></section>
      : list?.total === 0 ? <section className="flex flex-col items-center gap-3 rounded-card border border-line bg-surface p-10"><Mascot name="cheer" height={120} /><h2 className="font-bold">{filter === "OPEN" ? "Không còn báo cáo nào đang mở" : filter === "RESOLVED" ? "Chưa có báo cáo nào được xử lý" : "Chưa có báo cáo mã lỗi nào"}</h2>{filter === "OPEN" && <><p>Mọi báo cáo mã lỗi đã được xử lý. Báo cáo mới sẽ hiện ở đây.</p><Button onClick={() => choose("RESOLVED")}>Xem báo cáo đã xử lý</Button></>}</section>
      : list && <><div className="overflow-x-auto rounded-card border border-line bg-surface"><table className="w-full min-w-250 text-left text-body-sm"><thead className="bg-surface-subtle text-ink-muted"><tr>{["Voucher", "Lý do", "Ghi chú", "Điểm", "User", filter === "OPEN" ? "Thời gian chờ ↑" : filter === "RESOLVED" ? "Xử lý sau" : "Thời gian", "Ticket", "Báo cáo", ""].map((title, index) => <th key={index} className="px-3 py-4">{index === 5 && filter === "OPEN" ? <span className="inline-flex items-center gap-1"><Icon name="clock" size={16} />{title}</span> : title}</th>)}</tr></thead><tbody>{list.items.map(issue => {
        const sla = issue.status === "OPEN" ? openSlaView(issue, nowMs) : null;
        const resolvedSla = issue.status !== "OPEN" ? resolvedSlaView(issue) : null;
        const ticket = ticketStatusView(issue.ticketStatus), status = reportStatusView(issue.status);
        return <tr key={issue.id} onClick={event => { opener.current = event.currentTarget.querySelector("button"); setSelected(issue); }} className={`cursor-pointer border-t border-line focus-within:outline-2 focus-within:outline-primary ${sla?.overdue ? "border-l-4 border-l-danger bg-danger-soft" : "hover:bg-surface-subtle"}`}><td className="px-3 py-3"><button type="button" aria-label={`Xem báo cáo ${issue.reference}`} className="text-left font-bold focus:outline-none">{issue.voucher.title}</button><small className="block">{issue.voucher.brand.name} · {issue.reference}</small></td><td className="px-3 py-3">{CODE_ISSUE_ADMIN_REASON_LABELS[issue.reason]}<small className="block text-ink-muted">{issue.reason}</small></td><td className="max-w-40 truncate px-3 py-3" title={issue.note ?? undefined}>{issue.note ?? "—"}</td><td className="px-3 py-3 font-bold text-primary">{issue.pricePoints}<small className="block font-normal">{PRICE_SOURCE_LABELS[issue.priceSource]}</small></td><td className="px-3 py-3">{issue.userLabel}</td><td className={`px-3 py-3 ${sla?.overdue ? "text-danger-strong" : ""}`}>{sla ? <>{sla.age}<small className="block">{sla.line}</small></> : resolvedSla && <>{resolvedSla.took}<small className="block">{resolvedSla.at}{resolvedSla.late && ` · ${resolvedSla.late}`}</small></>}</td><td className="px-3 py-3"><Tag tone={ticket.tone}>{ticket.label}</Tag></td><td className="px-3 py-3"><Tag tone={status.tone}>{status.label}</Tag></td><td className="px-3 py-3"><span aria-hidden="true">›</span></td></tr>;
      })}</tbody></table></div><div className="mt-4 flex flex-wrap items-center justify-between gap-4"><p>{pageRangeText(list, filter, nowMs)}</p><nav aria-label="Trang báo cáo" className="flex gap-1"><Button size="sm" className="h-9! w-9 px-0!" variant="secondary" aria-label="Trang trước" disabled={offset === 0} onClick={() => setOffset(offset - PAGE_SIZE)}>‹</Button>{Array.from({ length: pages }, (_, index) => <Button key={index} size="sm" className="h-9! min-w-9 px-2!" variant={currentPage === index + 1 ? "primary" : "ghost"} aria-current={currentPage === index + 1 ? "page" : undefined} onClick={() => setOffset(index * PAGE_SIZE)}>{index + 1}</Button>)}<Button size="sm" className="h-9! w-9 px-0!" variant="secondary" aria-label="Trang sau" disabled={!list.hasMore} onClick={() => setOffset(offset + PAGE_SIZE)}>›</Button></nav></div></>}
    </div>
    {selected && <CodeIssueDrawer row={selected} nowMs={nowMs} onClose={() => setSelected(null)} onSuccess={resolved} onReload={query.reload} />}
    <CodeIssueToasts items={toasts} dismiss={dismiss} />
  </AdminPage>;
}
