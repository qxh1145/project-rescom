"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { AdminFlashSaleDto } from "@rescom/schemas";
import { AdminPage } from "@/components/layout/admin/AdminPage";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Select } from "@/components/ui/Select";
import { Tag } from "@/components/ui/Tag";
import { FlashSaleCard } from "@/app/(signed-in)/(app)/rewards/components/FlashSaleCard";
import { Countdown } from "@/app/(signed-in)/(app)/rewards/components/Countdown";
import { endAdminFlashSale } from "@/lib/admin/rewards-flash-service";
import { FLASH_END_REASONS, endEarlyCopy, flashRowView, flashStatusView, monitorItemView, monitorTotals } from "@/lib/admin/rewards-flash-view";
import { isApiError } from "@/lib/api/api-error";
import { serverOffset } from "@/lib/rewards/server-clock";
import { useAdminFlashSales } from "../hooks/use-admin-flash-sales";

type Reason = (typeof FLASH_END_REASONS)[number]["value"];
const POLL_MS = 30_000;

export function FlashSalesScreen() {
  const query = useAdminFlashSales();
  const { reload } = query;
  const [clock, setClock] = useState(() => Date.now());
  const [ending, setEnding] = useState<AdminFlashSaleDto | null>(null);
  const [preview, setPreview] = useState<AdminFlashSaleDto | null>(null);
  const [reason, setReason] = useState<Reason>("WRONG_PRICE");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const items = query.data?.items;
  // The client clock only ticks; every state and the Countdown target come from the server payload.
  const offset = useMemo(() => serverOffset(query.data?.serverTime ?? ""), [query.data?.serverTime]);
  const now = clock + offset;
  const live = items?.find((flash) => flash.status === "ACTIVE" || flash.status === "SOLD_OUT");
  const polling = Boolean(items?.some((flash) => flash.status === "ACTIVE" || flash.status === "UPCOMING"));

  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) setClock(Date.now()); }, 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!polling) return;
    const poll = window.setInterval(() => { if (!document.hidden) reload(); }, POLL_MS);
    return () => window.clearInterval(poll);
  }, [polling, reload]);

  async function confirmEnd() {
    if (!ending || busy || (reason === "OTHER" && !note.trim())) return;
    setBusy(true); setError("");
    try {
      await endAdminFlashSale(ending.id, { reason, ...(note.trim() ? { note: note.trim() } : {}) });
      setEnding(null); setNote(""); reload();
    } catch (cause) {
      if (isApiError(cause) && ["FLASH_ALREADY_ENDED", "FLASH_NOT_ACTIVE"].includes(cause.code ?? "")) {
        setError("Chương trình đã thay đổi hoặc đã kết thúc. Danh sách đang cập nhật."); reload();
      } else setError("Không thể kết thúc Flash Sale. Thử lại.");
    } finally { setBusy(false); }
  }

  const liveRow = live ? flashRowView(live) : null;
  return <AdminPage title="Flash Sale" meta={`${query.data?.summary.active ?? 0} đang diễn ra · ${query.data?.summary.upcoming ?? 0} sắp diễn ra`} actions={<Link href="/admin/flash-sales/new" className="rounded-control bg-primary px-5 py-3 font-bold text-white">Tạo Flash Sale</Link>}>
    <div className="space-y-6">
      {query.error && <div className="flex items-center gap-3"><Alert tone="danger">Không tải được Flash Sale.</Alert><Button onClick={reload}>Thử lại</Button></div>}
      {query.loading && !query.data && <div className="h-96 animate-pulse rounded-card bg-surface-subtle" aria-label="Đang tải Flash Sale" />}
      {live && liveRow && <section aria-label="Chương trình đang chạy" className="rounded-card border border-line bg-surface p-6">
        <div className="flex justify-between gap-4">
          <div>
            <Tag tone={flashStatusView(live.status).tone}>{flashStatusView(live.status).label}</Tag>
            <h2 className="mt-3 text-title-sm font-bold">{liveRow.title}</h2>
            <p className="text-ink-muted">{liveRow.windowLabel} · mỗi người {live.items[0]?.perUserCap ?? 1} suất mỗi voucher · chỉ tài khoản đã kích hoạt</p>
          </div>
          <div className="flex items-start gap-4">
            <div className="flex items-center gap-2">Kết thúc sau <Countdown endsAt={live.endsAt} nowMs={now} onElapsed={reload} /></div>
            {liveRow.actions.includes("end") && <Button variant="danger" onClick={() => setEnding(live)}>Kết thúc sớm</Button>}
          </div>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-3">{live.items.map((item) => {
          const view = monitorItemView(item, live);
          return <div key={item.voucherId} className="rounded-field border border-line p-4">
            <div className="flex items-start justify-between gap-2"><strong>{item.voucherTitle}</strong>{view.badge && <Tag tone="danger">{view.badge}</Tag>}</div>
            <p className="mt-1 font-bold">{view.priceLabel} <s className="font-normal text-ink-muted">{view.regularLabel}</s></p>
            <p className="mt-2 text-body-sm">{view.soldLabel}</p>
            <ProgressBar value={item.sold} max={item.quota} label={`${item.voucherTitle}: ${view.soldLabel}`} />
            <p className="mt-2 text-caption text-ink-muted">{view.footnote}</p>
          </div>;
        })}</div>
        <dl className="mt-5 grid gap-3 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-5">{monitorTotals(live).map((total) => <div key={total.label}><dt className="text-caption text-ink-muted">{total.label}</dt><dd className="font-semibold">{total.value}</dd></div>)}</dl>
      </section>}
      {query.data && items && <section className="overflow-x-auto rounded-card border border-line bg-surface">
        <h2 className="p-5 text-title-sm font-bold">Tất cả chương trình</h2>
        <table className="w-full min-w-[850px] text-left text-body-sm">
          <thead><tr className="bg-surface-subtle">{["Chương trình", "Thời gian", "Đã đổi / số suất", "Voucher", "Trạng thái", "Thao tác"].map((label) => <th scope="col" className="p-4" key={label}>{label}</th>)}</tr></thead>
          <tbody>{items.map((flash) => {
            const row = flashRowView(flash), status = flashStatusView(flash.status);
            return <tr key={flash.id} className="border-t border-line">
              <td className="p-4"><strong>{row.title}</strong><p className="text-ink-muted">{row.subtitle}</p></td>
              <td className="p-4">{row.windowLabel}</td>
              <td className="p-4">{row.soldLabel}<ProgressBar value={row.soldRatio * 100} label={`${flash.code}: ${row.soldLabel} suất`} /></td>
              <td className="p-4">{row.vouchersLabel}</td>
              <td className="p-4"><Tag tone={status.tone}>{status.label}</Tag></td>
              <td className="p-4"><div className="flex gap-3">
                {row.actions.includes("preview") && <button type="button" className="text-primary" onClick={() => setPreview(flash)}>Xem trước</button>}
                {row.actions.includes("edit") && <Link className="text-primary" href={`/admin/flash-sales/${flash.id}/edit`}>Sửa</Link>}
                {row.actions.includes("end") && <button type="button" className="text-danger" onClick={() => setEnding(flash)}>Kết thúc sớm</button>}
              </div></td>
            </tr>;
          })}</tbody>
        </table>
        {!items.length && <p className="p-10 text-center">Chưa có Flash Sale nào · <Link href="/admin/flash-sales/new" className="text-primary">Tạo Flash Sale</Link></p>}
      </section>}
    </div>
    <Dialog open={!!ending} labelledBy="end-flash-title" onClose={() => !busy && setEnding(null)} dismissible={!busy}>
      <div className="space-y-4 p-6">
        <h2 id="end-flash-title" className="text-title-sm font-bold">Kết thúc sớm {ending?.code}?</h2>
        {ending && <ul className="list-disc space-y-2 pl-5">{endEarlyCopy(ending).map((line) => <li key={line}>{line}</li>)}</ul>}
        <Select id="end-flash-reason" label="Lý do" options={FLASH_END_REASONS} value={reason} onChange={(event) => setReason(event.target.value as Reason)} />
        <label className="block">Ghi chú {reason === "OTHER" ? "(bắt buộc)" : ""}<textarea className="mt-1 w-full rounded-field border border-line p-3" maxLength={200} value={note} onChange={(event) => setNote(event.target.value)} aria-required={reason === "OTHER"} /></label>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex gap-3"><Button variant="secondary" disabled={busy} onClick={() => setEnding(null)}>Huỷ</Button><Button variant="danger" disabled={busy || (reason === "OTHER" && !note.trim())} onClick={() => void confirmEnd()}>Kết thúc sớm</Button></div>
      </div>
    </Dialog>
    <Dialog open={!!preview} labelledBy="flash-preview-title" onClose={() => setPreview(null)}>
      <div className="space-y-4 p-6">
        <h2 id="flash-preview-title" className="text-title-sm font-bold">Xem trước {preview?.code}</h2>
        <div className="grid gap-3 sm:grid-cols-2">{preview?.items.map((item) => <FlashSaleCard key={item.voucherId} item={item} startsAt={preview.startsAt} nowMs={now} />)}</div>
        <Button variant="secondary" onClick={() => setPreview(null)}>Đóng</Button>
      </div>
    </Dialog>
  </AdminPage>;
}
