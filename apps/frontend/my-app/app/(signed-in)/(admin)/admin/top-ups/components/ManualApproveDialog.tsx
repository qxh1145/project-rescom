"use client";

import type { ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { IconButton } from "@/components/ui/IconButton";
import { formatTransferReference, requesterName } from "@/lib/admin/top-up-admin";
import type { AdminTopUp } from "@/lib/admin/top-up-admin-service";
import { itemCode, PAYOS_SWITCH_COPY } from "@/lib/admin/payos-switch";
import { formatPoints, formatVnd } from "@/lib/wallet/top-up";

interface ManualApproveDialogProps {
  item: AdminTopUp;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  children?: ReactNode;
}

/**
 * Quick "Duyệt" confirmation dialog for B4 card (Story 13.13, Decision D3).
 *
 * Title: "Duyệt yêu cầu {code}?"
 * Body rows:
 * - "Cộng {points} Điểm cho {name} ({email})."
 * - "Chỉ duyệt khi sao kê có khoản {amount} với nội dung {ref}."
 * Buttons: "Huỷ" and "Duyệt".
 */
export function ManualApproveDialog({
  item,
  busy,
  error,
  onClose,
  onConfirm,
  children,
}: ManualApproveDialogProps) {
  const code = itemCode(item);
  const name = requesterName(item);
  const email = item.userEmail ?? "";
  const points = formatPoints(item.amount);
  const amount = formatVnd(item.amountVnd);
  const ref = formatTransferReference(item.transferReference);

  function close() {
    if (busy) return;
    onClose();
  }

  return (
    <Dialog open onClose={close} labelledBy="approve-top-up-title" width={520} dismissible={!busy}>
      <div className="p-5 lg:p-7">
        <div className="flex items-start gap-3">
          <div className="mr-auto">
            <h2 id="approve-top-up-title" className="text-[20px] font-extrabold text-ink lg:text-title-sm">
              {PAYOS_SWITCH_COPY.confirmApproveTitle(code)}
            </h2>
          </div>
          <IconButton icon="x" label="Đóng" onClick={close} disabled={busy} />
        </div>

        <div className="mt-4 space-y-2 text-body-sm text-ink-strong">
          <p>{PAYOS_SWITCH_COPY.confirmApproveCredit(points, name, email)}</p>
          <p className="text-ink-muted">{PAYOS_SWITCH_COPY.confirmApproveStatement(amount, ref)}</p>
        </div>

        {error ? (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        ) : null}

        <div className="mt-6 flex gap-3 lg:justify-end">
          <Button variant="secondary" size="xl" onClick={close} disabled={busy}>
            {PAYOS_SWITCH_COPY.buttonCancel}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="lg"
            className="flex-1 lg:flex-none"
            loading={busy}
            loadingLabel="Đang duyệt…"
            onClick={() => void onConfirm()}
          >
            {PAYOS_SWITCH_COPY.buttonApprove}
          </Button>
        </div>
        {children}
      </div>
    </Dialog>
  );
}
