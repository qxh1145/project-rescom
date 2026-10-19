"use client";

import { useState } from "react";
import type { AdminPointCreditListItem } from "@rescom/schemas";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Textarea } from "@/components/ui/Textarea";
import { creditReasonError } from "@/lib/admin/users-view";
import { formatPoints } from "@/lib/wallet/top-up";

interface ReverseCreditDialogProps {
  open: boolean;
  credit: AdminPointCreditListItem | null;
  busy: boolean;
  error: string | null;
  onConfirm: (journalId: string, reason: string) => void;
  onClose: () => void;
}

const TITLE_ID = "admin-reverse-credit-confirm-title";

export function ReverseCreditDialog({
  open,
  credit,
  busy,
  error,
  onConfirm,
  onClose,
}: ReverseCreditDialogProps) {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setReason("");
    setReasonError(null);
    onClose();
  };

  const confirm = () => {
    if (!credit) return;
    const err = creditReasonError(reason);
    if (err) {
      setReasonError(err);
      return;
    }
    onConfirm(credit.journalId, reason.trim());
  };

  const amountText = credit ? formatPoints(credit.amount) : "0";

  return (
    <Dialog
      open={open}
      onClose={close}
      labelledBy={TITLE_ID}
      width={480}
      dismissible={!busy}
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id={TITLE_ID} className="text-title-sm font-extrabold text-ink">
          Hoàn tác {amountText} Điểm đã cộng?
        </h2>
        <div className="flex flex-col gap-2 text-body-sm text-ink-strong">
          <p>
            Hệ thống tạo bút toán đảo, trừ {amountText} Điểm khỏi số dư Khả dụng
            của người dùng. Không thực hiện được nếu người dùng đã dùng số Điểm này.
          </p>
          {credit?.reason ? (
            <p className="text-caption text-ink-muted">
              Lý do lúc cộng: {credit.reason}
            </p>
          ) : null}
        </div>

        <Textarea
          id="admin-reverse-credit-reason"
          label="Lý do hoàn tác"
          rows={3}
          maxLength={500}
          value={reason}
          disabled={busy}
          placeholder="Giao dịch nhầm lẫn, hoàn tác theo yêu cầu hỗ trợ..."
          error={reasonError ?? undefined}
          onChange={(event) => {
            setReason(event.target.value);
            if (reasonError) setReasonError(null);
          }}
        />

        {error ? <Alert tone="danger">{error}</Alert> : null}

        <div className="flex justify-end gap-3">
          <Button variant="secondary" size="md" disabled={busy} onClick={close}>
            Huỷ
          </Button>
          <Button
            variant="danger"
            size="md"
            loading={busy}
            loadingLabel="Đang hoàn tác…"
            onClick={confirm}
          >
            Hoàn tác
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
