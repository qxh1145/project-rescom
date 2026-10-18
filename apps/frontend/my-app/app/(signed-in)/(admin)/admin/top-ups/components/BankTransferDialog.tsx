"use client";

import { useState } from "react";
import type { AdminTopUpRefundDetail } from "@rescom/schemas";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { payosAdminErrorMessage } from "@/lib/admin/payos-top-up-admin-messages";
import { bankTransferState } from "@/lib/admin/payos-top-up-refund";

export function BankTransferDialog({
  item,
  busy,
  open,
  onClose,
  onConfirm,
}: {
  item: AdminTopUpRefundDetail | null;
  busy: boolean;
  open: boolean;
  onClose: () => void;
  onConfirm: (data: {
    bankTransferReference?: string;
    bankTransferredAt?: string;
  }) => Promise<void>;
}) {
  const [prevKey, setPrevKey] = useState<string | null>(null);
  const [bankRef, setBankRef] = useState("");
  const [transferredAt, setTransferredAt] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);

  const currentKey = open && item ? `${item.id}:${open}` : null;
  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    setBankRef("");
    setTransferredAt("");
    setClientError(null);
  }

  if (!item || !open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setClientError(null);

    const state = bankTransferState(
      {
        reference: bankRef.trim() || undefined,
        transferredAt: transferredAt || undefined,
      },
      new Date(item!.submittedAt),
      new Date(),
    );

    if (!state.valid) {
      setClientError(state.error ?? "Vui lòng nhập ít nhất một thông tin hợp lệ.");
      return;
    }

    try {
      await onConfirm({
        bankTransferReference: state.reference ?? undefined,
        bankTransferredAt: state.transferredAt ?? undefined,
      });
    } catch (err) {
      setClientError(payosAdminErrorMessage(err));
    }
  }

  const hasInput = Boolean(bankRef.trim() || transferredAt);

  return (
    <Dialog
      key={item.id}
      open
      onClose={onClose}
      labelledBy="bank-transfer-dialog-title"
      dismissible={!busy}
      className="max-w-md w-full p-6"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <h3 id="bank-transfer-dialog-title" className="text-lg font-bold text-ink">
          Thêm mã chuyển khoản #{item.orderCode}
        </h3>
        <p className="text-xs text-ink-muted leading-relaxed">
          Ghi nhận thông tin uỷ nhiệm chi hoặc thời gian đã hoàn tất chuyển khoản ngân hàng.
          Thông tin này chỉ có thể thêm một lần.
        </p>

        {clientError && (
          <Alert tone="danger" className="text-xs">
            {clientError}
          </Alert>
        )}

        <div>
          <label htmlFor="bank-ref-field" className="block text-xs font-semibold text-ink-muted mb-1">
            Mã giao dịch ngân hàng
          </label>
          <input
            id="bank-ref-field"
            type="text"
            maxLength={100}
            value={bankRef}
            onChange={(e) => setBankRef(e.target.value)}
            placeholder="VD: FT261016ABC123"
            className="w-full rounded border border-line px-3 py-1.5 text-sm text-ink bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div>
          <label htmlFor="bank-time-field" className="block text-xs font-semibold text-ink-muted mb-1">
            Thời điểm chuyển khoản
          </label>
          <input
            id="bank-time-field"
            type="datetime-local"
            value={transferredAt}
            onChange={(e) => setTransferredAt(e.target.value)}
            className="w-full rounded border border-line px-3 py-1.5 text-sm text-ink bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div className="flex justify-end gap-3 pt-3 border-t border-line">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" disabled={!hasInput || busy} aria-busy={busy}>
            {busy ? "Đang ghi nhận…" : "Ghi nhận chuyển khoản"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
