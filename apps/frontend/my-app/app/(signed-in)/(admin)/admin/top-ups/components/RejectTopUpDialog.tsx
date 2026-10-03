"use client";

import { useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { IconButton } from "@/components/ui/IconButton";
import { Textarea } from "@/components/ui/Textarea";
import {
  TOP_UP_REJECTION_REASON_MAX_LENGTH,
  formatTransferReference,
  rejectReasonError,
  requesterName,
} from "@/lib/admin/top-up-admin";
import type { AdminTopUp } from "@/lib/admin/top-up-admin-service";
import { formatPoints } from "@/lib/wallet/top-up";

interface RejectTopUpDialogProps {
  item: AdminTopUp;
  busy: boolean;
  /** Server refusal copy. */
  error: string | null;
  onClose: () => void;
  /** Resolves true when the request was rejected (the parent then closes the dialog). */
  onConfirm: (reason: string) => Promise<boolean>;
}

/**
 * "Từ chối…" confirmation — ASSUMED (design) design (not drawn), same panel as the
 * other confirm dialogs. The reason is required (backend
 * `rejectTopUpRequestSchema`: 5–500 characters) and is sent to the user.
 * Mounted only while open, so each opening starts with an empty reason.
 */
export function RejectTopUpDialog({ item, busy, error, onClose, onConfirm }: RejectTopUpDialogProps) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const validation = touched ? rejectReasonError(reason) : null;

  function close() {
    if (busy) return;
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (rejectReasonError(reason)) return;
    await onConfirm(reason.trim());
  }

  return (
    <Dialog open onClose={close} labelledBy="reject-top-up-title" width={520} dismissible={!busy}>
      <form className="p-5 lg:p-7" onSubmit={(event) => void submit(event)} noValidate>
        <div className="flex items-start gap-3">
          <div className="mr-auto">
            <h2 id="reject-top-up-title" className="text-[20px] font-extrabold text-ink lg:text-title-sm">
              Từ chối yêu cầu nạp?
            </h2>
            <p className="mt-1 text-body-sm text-ink-muted">
              {requesterName(item)} · {formatPoints(item.amount)} điểm ·{" "}
              <span className="font-mono">{formatTransferReference(item.transferReference)}</span>
            </p>
          </div>
          <IconButton icon="x" label="Đóng" onClick={close} disabled={busy} />
        </div>
        <p className="mt-4 text-body-sm text-ink-strong">
          Không cộng điểm. Người dùng nhận thông báo kèm lý do dưới đây.
        </p>
        <Textarea
          id="reject-top-up-reason"
          label="Lý do từ chối"
          className="mt-3"
          value={reason}
          maxLength={TOP_UP_REJECTION_REASON_MAX_LENGTH}
          placeholder="Ví dụ: Không tìm thấy giao dịch khớp nội dung chuyển khoản."
          onChange={(event) => setReason(event.target.value)}
          onBlur={() => setTouched(true)}
          error={validation ?? undefined}
          disabled={busy}
          required
        />
        {error ? (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        ) : null}
        <div className="mt-6 flex gap-3 lg:justify-end">
          <Button variant="secondary" size="xl" onClick={close} disabled={busy}>
            Huỷ
          </Button>
          <Button
            type="submit"
            variant="danger"
            size="lg"
            className="flex-1 lg:flex-none"
            loading={busy}
            loadingLabel="Đang từ chối…"
          >
            Từ chối yêu cầu
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
