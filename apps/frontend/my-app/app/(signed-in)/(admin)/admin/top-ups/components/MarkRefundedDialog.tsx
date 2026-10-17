"use client";

import { useState } from "react";
import type { AdminTopUpRefundDetail } from "@rescom/schemas";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { payosAdminErrorMessage } from "@/lib/admin/payos-top-up-admin-messages";
import { formatVnd } from "@/lib/wallet/top-up";
import { bankTransferState } from "@/lib/admin/payos-top-up-refund";

export function MarkRefundedDialog({
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
    destinationConfirmed: boolean;
    bankTransferReference?: string;
    bankTransferredAt?: string;
  }) => Promise<void>;
}) {
  const [prevKey, setPrevKey] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [bankRef, setBankRef] = useState("");
  const [transferredAt, setTransferredAt] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);

  const currentKey = open && item ? `${item.id}:${open}` : null;
  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    setConfirmed(false);
    setBankRef("");
    setTransferredAt("");
    setClientError(null);
  }

  if (!item || !open) return null;

  const needsConfirmation = !item.destination.verified;
  const canSubmit = !needsConfirmation || confirmed;
  // Show only the facts we have; an unverified destination may lack any of them.
  const destinationText =
    [
      [item.destination.bankName ?? item.destination.bankId, item.destination.accountNumber]
        .filter(Boolean)
        .join(" "),
      item.destination.holderName,
    ]
      .filter(Boolean)
      .join(" · ") || "tài khoản đã thanh toán";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setClientError(null);

    if (needsConfirmation && !confirmed) {
      setClientError("Vui lòng xác nhận đã kiểm tra tài khoản đích với user qua email.");
      return;
    }

    let transferredAtIso: string | undefined = undefined;
    if (bankRef.trim() || transferredAt) {
      const state = bankTransferState(
        {
          reference: bankRef.trim() || undefined,
          transferredAt: transferredAt ? new Date(transferredAt) : undefined,
        },
        new Date(item!.submittedAt),
        new Date(),
      );
      if (!state.valid) {
        setClientError(state.error ?? "Dữ liệu chuyển khoản không hợp lệ.");
        return;
      }
      transferredAtIso = state.transferredAt ?? undefined;
    }

    try {
      await onConfirm({
        destinationConfirmed: needsConfirmation ? confirmed : true,
        bankTransferReference: bankRef.trim() || undefined,
        bankTransferredAt: transferredAtIso,
      });
    } catch (err) {
      setClientError(payosAdminErrorMessage(err));
    }
  }

  return (
    <Dialog
      key={item.id}
      open
      onClose={onClose}
      labelledBy="mark-refunded-title"
      dismissible={!busy}
      className="max-w-md w-full p-6"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <h3 id="mark-refunded-title" className="text-lg font-bold text-ink">
          Đánh dấu Đã hoàn {formatVnd(item.amountVnd)}?
        </h3>

        {clientError && (
          <Alert tone="danger" className="text-xs">
            {clientError}
          </Alert>
        )}

        {/* Info Rows per D4 */}
        <div className="rounded-lg border border-line bg-surface-subtle p-3.5 text-xs text-ink space-y-2">
          <p className="leading-relaxed">
            • Đánh dấu trước, rồi chuyển khoản <strong>{formatVnd(item.amountVnd)}</strong> về{" "}
            <strong>{destinationText}</strong>
            .
          </p>
          <p className="leading-relaxed">
            • Sẽ trừ <strong>{item.points} Điểm</strong> đang giữ của user (bút toán hoàn tiền nạp
            Điểm).
          </p>
          <p className="leading-relaxed font-semibold text-rose-600">
            • User nhận thông báo “Đã hoàn tiền”. Không hoàn tác được.
          </p>
        </div>

        {/* Optional Bank Reference */}
        <div>
          <label htmlFor="bank-ref-input" className="block text-xs font-semibold text-ink-muted mb-1">
            Mã giao dịch ngân hàng (không bắt buộc)
          </label>
          <input
            id="bank-ref-input"
            type="text"
            maxLength={100}
            value={bankRef}
            onChange={(e) => setBankRef(e.target.value)}
            placeholder="VD: FT261016123456"
            className="w-full rounded border border-line px-3 py-1.5 text-sm text-ink bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-[11px] text-ink-muted mt-0.5 block">
            Giúp đối soát khi user hỏi lại. Có thể thêm sau, 1 lần.
          </span>
        </div>

        {/* Optional Transfer Time */}
        <div>
          <label htmlFor="bank-time-input" className="block text-xs font-semibold text-ink-muted mb-1">
            Thời điểm chuyển (không bắt buộc)
          </label>
          <input
            id="bank-time-input"
            type="datetime-local"
            value={transferredAt}
            onChange={(e) => setTransferredAt(e.target.value)}
            className="w-full rounded border border-line px-3 py-1.5 text-sm text-ink bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Unverified confirmation checkbox (server-enforced via D3) */}
        {needsConfirmation && (
          <label className="flex items-start gap-2.5 pt-2 text-xs text-ink cursor-pointer border-t border-line">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 size-4 rounded border-line text-primary focus:ring-primary"
            />
            <span className="leading-tight font-medium text-amber-900">
              Tôi đã xác minh tài khoản nhận với user qua email.
            </span>
          </label>
        )}

        <div className="flex justify-end gap-3 pt-3 border-t border-line">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Huỷ
          </Button>
          <Button type="submit" disabled={!canSubmit || busy} aria-busy={busy}>
            {busy ? "Đang xử lý…" : "Đã hoàn tiền"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
