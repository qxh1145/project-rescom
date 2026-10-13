"use client";

import Link from "next/link";
import { useState } from "react";
import type { AdminVoucherListDto } from "@rescom/schemas";
import { AdminPage } from "@/components/layout/admin/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Tag } from "@/components/ui/Tag";
import { Toggle } from "@/components/ui/Toggle";
import { patchAdminVoucher } from "@/lib/admin/rewards-vouchers-service";
import { STATUS_FILTERS, voucherActionsOf, voucherRowView } from "@/lib/admin/rewards-vouchers-view";
import { useAdminVouchers } from "../hooks/use-admin-vouchers";

type Voucher = AdminVoucherListDto["items"][number];
type Filter = "ALL" | "ACTIVE" | "PAUSED" | "SOLD_OUT" | "EXPIRED" | "HIDDEN";

export function VouchersScreen() {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [search, setSearch] = useState("");
  const query = useAdminVouchers(filter, search);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Voucher | null>(null);
  const [action, setAction] = useState<"PAUSED" | "ACTIVE" | "ARCHIVED" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [seenData, setSeenData] = useState(query.data);
  // Server data is fresh again: drop optimistic overrides so a later reload wins.
  if (seenData !== query.data) { setSeenData(query.data); setOverrides({}); }
  const summary = query.data?.summary;
  const items = query.data?.items ?? [];

  async function toggle(voucher: Voucher, isVisible: boolean) {
    setOverrides((old) => ({ ...old, [voucher.id]: isVisible })); setError("");
    try {
      await patchAdminVoucher(voucher.id, { isVisible });
      query.reload();
    } catch {
      setOverrides((old) => ({ ...old, [voucher.id]: !isVisible }));
      setError("Không đổi được trạng thái hiển thị. Thử lại.");
    }
  }

  async function confirm() {
    if (!selected || !action) return;
    setBusy(true); setError("");
    try {
      await patchAdminVoucher(selected.id, { state: action });
      setAction(null);
      setSelected(null);
      query.reload();
    } catch {
      setError("Không cập nhật được voucher. Thử lại.");
    } finally {
      setBusy(false);
    }
  }

  return <AdminPage title="Voucher" meta={`${summary?.total ?? 0} voucher · ${summary?.active ?? 0} đang phân phối`} actions={<Link href="/admin/vouchers/new" className="rounded-control bg-primary px-5 py-3 font-bold text-white">Tạo voucher</Link>}>
    <div className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}
      {query.error && <div className="flex gap-3"><Alert tone="danger">Không tải được danh sách voucher.</Alert><Button onClick={query.reload}>Thử lại</Button></div>}
      <div className="grid grid-cols-3 gap-4">{[["Đang phân phối", summary?.active], ["Sắp hết (≤ 10%)", summary?.lowStock.length], ["Mã chưa phát", summary?.codesAvailable]].map(([label, value]) => <div key={label} className="rounded-card border border-line bg-surface p-5"><p className="text-ink-muted">{label}</p><strong className="text-title-sm">{value ?? "—"}</strong></div>)}</div>
      <div className="flex flex-wrap items-center gap-3" role="group" aria-label="Lọc trạng thái">{summary && STATUS_FILTERS(summary).map(({ key, label }) => <button type="button" key={key} onClick={() => setFilter(key as Filter)} aria-pressed={filter === key} className={`rounded-full border px-4 py-2 ${filter === key ? "border-primary bg-tone-green-bg text-primary" : "border-line bg-surface"}`}>{label}</button>)}<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tìm voucher" aria-label="Tìm voucher" className="ml-auto rounded-field border border-line p-2" /></div>
      <div className="overflow-x-auto rounded-card border border-line bg-surface"><table className="w-full min-w-[1000px] text-left text-body-sm"><thead className="bg-surface-subtle"><tr>{["Voucher · thương hiệu", "Giá trị", "Giá điểm", "Tồn kho", "Đã đổi", "Thời gian đổi", "Trạng thái", "Hiển thị", "Thao tác"].map((heading) => <th scope="col" className="p-4" key={heading}>{heading}</th>)}</tr></thead><tbody>
        {items.map((voucher) => { const view = voucherRowView(voucher); const visible = overrides[voucher.id] ?? voucher.isVisible; return <tr key={voucher.id} className="border-t border-line"><td className="p-4"><Link className="font-bold text-primary" href={`/admin/vouchers/${voucher.id}`}>{voucher.title}</Link><p>{voucher.brand.name}</p></td><td className="p-4">{voucher.valueVnd.toLocaleString("vi-VN")}đ</td><td className="p-4">{view.priceLabel}<p>{view.priceNote}</p></td><td className="p-4">{view.stockLabel}<p>{view.reservedLabel}</p></td><td className="p-4">{voucher.stock.issued}</td><td className="p-4">{view.windowLabel}</td><td className="p-4"><Tag tone={view.statusTone}>{view.statusLabel}</Tag></td><td className="p-4"><Toggle checked={visible} disabled={voucher.state === "ARCHIVED"} aria-label={`Hiển thị ${voucher.title}`} onCheckedChange={(next) => void toggle(voucher, next)} /></td><td className="p-4"><details className="relative"><summary aria-label={`Thao tác ${voucher.title}`} className="cursor-pointer list-none rounded-field border border-line px-3 py-1">⋮</summary><div className="absolute right-0 z-10 flex min-w-44 flex-col rounded-field border border-line bg-surface p-2 shadow-lg">{voucherActionsOf(voucher).map(({ key, label }) => key === "edit" ? <Link key={key} href={`/admin/vouchers/${voucher.id}/edit`} className="p-2 text-primary">{label}</Link> : key === "price" || key === "stock" || key === "history" ? <Link key={key} href={`/admin/vouchers/${voucher.id}`} className="p-2 text-primary">{label}</Link> : <button key={key} type="button" className={`p-2 text-left ${key === "archive" ? "text-danger" : "text-primary"}`} onClick={() => { if (key === "visibility") void toggle(voucher, !visible); else { setSelected(voucher); setAction(key === "archive" ? "ARCHIVED" : voucher.state === "PAUSED" ? "ACTIVE" : "PAUSED"); } }}>{key === "visibility" ? (visible ? "Ẩn" : "Hiện") : label}</button>)}</div></details></td></tr>; })}
      </tbody></table>{query.loading && <div className="min-h-64 animate-pulse bg-surface-subtle" aria-label="Đang tải voucher" />}{!query.loading && !query.error && !items.length && <div className="p-10 text-center">Chưa có voucher nào · <Link href="/admin/vouchers/new" className="text-primary">Tạo voucher</Link></div>}</div>
      <p className="text-body-sm text-ink-muted">Hiển thị = có trong danh sách Đổi quà. Tạm ngừng = vẫn hiện nhưng khoá nút Đổi. Voucher đã có người đổi không xoá được, chỉ ẩn.</p>
    </div>
    <Dialog open={Boolean(action)} labelledBy="voucher-action-title" onClose={() => !busy && setAction(null)} dismissible={!busy}><div className="space-y-4 p-6"><h2 id="voucher-action-title" className="text-title-sm font-bold">{action === "ARCHIVED" ? "Lưu trữ voucher?" : action === "PAUSED" ? "Tạm ngừng voucher?" : "Tiếp tục phân phối?"}</h2><p>{action === "ARCHIVED" ? "Đây là thao tác cuối cùng. Voucher đã phát vẫn sử dụng được." : action === "PAUSED" ? "Voucher vẫn hiện nhưng người dùng không thể đổi." : "Người dùng có thể tiếp tục đổi voucher."}</p><div className="flex gap-3"><Button variant="secondary" disabled={busy} onClick={() => setAction(null)}>Huỷ</Button><Button disabled={busy} onClick={() => void confirm()}>Xác nhận</Button></div></div></Dialog>
  </AdminPage>;
}
