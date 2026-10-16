"use client";
import type { ReactNode } from "react";
import type { AdminPayosTopUp } from "@rescom/schemas";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { TopUpStatusChip } from "@/components/wallet/TopUpStatusChip";
import { topUpChip } from "@/lib/wallet/top-up-history";
import { formatShortDateTime } from "@/lib/format/date-time";
import { formatVnd } from "@/lib/wallet/top-up";

export function PayosTopUpDrawer({ item, busy, onClose, onRecheck, children }: { item: AdminPayosTopUp | null; busy: boolean; onClose: () => void; onRecheck: () => void; children?: ReactNode }) {
  if (!item) return null;
  const rows: [string, string | number | null][] = [
    ["Mã giao dịch", item.orderCode], ["Email", item.userEmail], ["Số tiền", formatVnd(item.amountVnd)],
    ["Số tiền nhận", item.amountPaidVnd === null ? null : formatVnd(item.amountPaidVnd)], ["Điểm", item.points], ["Điểm đã cộng", item.pointsCredited],
    ["Tạo lúc", formatShortDateTime(item.createdAt)], ["Thanh toán lúc", item.paidAt ? formatShortDateTime(item.paidAt) : null],
    ["Hết hạn lúc", formatShortDateTime(item.expiresAt)], ["Huỷ lúc", item.cancelledAt ? formatShortDateTime(item.cancelledAt) : null],
  ];
  return <Dialog open onClose={onClose} labelledBy="payos-top-up-drawer-title" dismissible={!busy} className="ml-auto mr-0 h-dvh max-h-dvh rounded-none p-6">
    <div className="flex items-center justify-between gap-4"><h2 id="payos-top-up-drawer-title" className="text-lg font-bold">Giao dịch #{item.orderCode}</h2>
      <button type="button" disabled={busy} aria-label="Đóng" onClick={onClose}>✕</button></div>
    <div className="mt-5"><TopUpStatusChip chip={topUpChip(item.status, "PAYOS")} /></div>
    <dl className="my-6 divide-y divide-line">{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-3 text-sm"><dt className="text-ink-muted">{label}</dt><dd className="break-all text-right font-semibold">{value ?? "—"}</dd></div>)}</dl>
    <Button type="button" disabled={busy} aria-busy={busy} onClick={onRecheck} variant="outline" fullWidth>{busy ? "Đang kiểm tra…" : "Kiểm tra lại với payOS"}</Button>
    {/* Modal <dialog> sits in the top layer; toasts must render inside it to stay visible. */}
    {children}
  </Dialog>;
}
