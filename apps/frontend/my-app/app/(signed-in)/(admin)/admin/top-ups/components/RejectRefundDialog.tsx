"use client";

import { useState } from "react";
import type { AdminTopUpRefundDetail } from "@rescom/schemas";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { payosAdminErrorMessage } from "@/lib/admin/payos-top-up-admin-messages";
import { rejectReasonState } from "@/lib/admin/payos-top-up-refund";

const PRESETS = [
  "Điểm đã được sử dụng một phần hoặc toàn bộ.",
  "Thông tin tài khoản nhận tiền không khớp hoặc không hợp lệ.",
  "Giao dịch không đủ điều kiện theo chính sách hoàn tiền.",
];

export function RejectRefundDialog({
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
  onConfirm: (data: { reason: string; manualTransferRecorded: boolean }) => Promise<void>;
}) {
  const [prevKey, setPrevKey] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [manualTransfer, setManualTransfer] = useState(false);
  const [clientError, setClientError] = useState<string | null>(null);

  const currentKey = open && item ? `${item.id}:${open}` : null;
  if (currentKey !== prevKey) {
    setPrevKey(currentKey);
    setReason("");
    setManualTransfer(false);
    setClientError(null);
  }

  if (!item || !open) return null;

  const isHeld = item.heldPoints > 0;
  const reasonValidation = rejectReasonState(reason);
  const canSubmit = reasonValidation.valid;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setClientError(null);

    if (!reasonValidation.valid) {
      setClientError("Vui lòng nhập lý do từ chối (1–500 ký tự).");
      return;
    }

    try {
      await onConfirm({
        reason: reasonValidation.value,
        manualTransferRecorded: isHeld ? false : manualTransfer,
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
      labelledBy="reject-refund-title"
      dismissible={!busy}
      className="max-w-md w-full p-6"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <h3 id="reject-refund-title" className="text-lg font-bold text-ink">
          Từ chối yêu cầu hoàn tiền #{item.orderCode}
        </h3>

        {clientError && (
          <Alert tone="danger" className="text-xs">
            {clientError}
          </Alert>
        )}

        {isHeld ? (
          <p className="text-xs text-ink-muted leading-relaxed">
            {item.heldPoints} Điểm đang giữ sẽ trả lại Khả dụng của user.
          </p>
        ) : (
          <p className="text-xs text-ink-muted leading-relaxed">
            Yêu cầu này không giữ Điểm của user.
          </p>
        )}

        <div>
          <label htmlFor="reject-presets" className="block text-xs font-semibold text-ink-muted mb-1">
            Gợi ý lý do từ chối:
          </label>
          <div id="reject-presets" className="flex flex-wrap gap-1.5 mb-2.5">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setReason(p)}
                className="text-xs bg-surface-subtle hover:bg-line border border-line rounded px-2.5 py-1 text-left text-ink transition-colors"
              >
                {p}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between mb-1">
            <label htmlFor="reject-reason-textarea" className="block text-xs font-semibold text-ink-muted">
              Lý do từ chối (bắt buộc)
            </label>
            <span
              className={`text-xs ${
                reasonValidation.length > reasonValidation.max ? "text-rose-600 font-bold" : "text-ink-muted"
              }`}
            >
              {reasonValidation.length}/{reasonValidation.max}
            </span>
          </div>

          <textarea
            id="reject-reason-textarea"
            required
            rows={3}
            maxLength={reasonValidation.max}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Nhập lý do gửi đến người dùng…"
            className="w-full rounded border border-line p-2.5 text-sm text-ink bg-surface focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <span className="text-[11px] text-ink-muted mt-0.5 block">
            User sẽ thấy nội dung này trong thông báo và trên giao dịch.
          </span>
        </div>

        {/* Checkbox only shown for hold-less requests per AC 6 */}
        {!isHeld && (
          <label className="flex items-start gap-2.5 pt-1 text-xs cursor-pointer border-t border-line">
            <input
              type="checkbox"
              checked={manualTransfer}
              onChange={(e) => setManualTransfer(e.target.checked)}
              className="mt-0.5 size-4 rounded border-line text-primary focus:ring-primary"
            />
            <div className="space-y-0.5">
              <span className="font-semibold text-ink block">Tôi đã chuyển trả tiền thủ công</span>
              <span className="text-[11px] text-ink-muted block leading-tight">
                Chỉ dùng cho yêu cầu không giữ Điểm: ghi nhận đã trả tiền ngoài hệ thống, không trừ Điểm của user.
              </span>
            </div>
          </label>
        )}

        <div className="pt-2 text-[11px] text-ink-muted border-t border-line">
          Mỗi giao dịch chỉ gửi yêu cầu 1 lần; sau khi từ chối, user không gửi lại được.
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
            Huỷ
          </Button>
          <Button
            type="submit"
            variant="danger"
            disabled={!canSubmit || busy}
            aria-busy={busy}
          >
            {busy ? "Đang xử lý…" : "Từ chối"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
