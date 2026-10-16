"use client";

import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { formatPoints } from "@/lib/wallet/top-up";

interface WithdrawRefundDialogProps {
  open: boolean;
  withdrawing: boolean;
  error: string | null;
  points: number;
  eligible: boolean;
  onClose: () => void;
  onWithdraw: () => void;
}

/**
 * Refund withdrawal confirmation dialog (Story 13.11, AC 6; UX-DR-P18, Decision D6).
 */
export function WithdrawRefundDialog({
  open,
  withdrawing,
  error,
  points,
  eligible,
  onClose,
  onWithdraw,
}: WithdrawRefundDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      labelledBy="withdraw-refund-dialog-title"
      width={480}
      dismissible={!withdrawing}
    >
      <div className="flex flex-col p-6">
        <h2
          id="withdraw-refund-dialog-title"
          className="text-title-sm font-bold text-ink"
        >
          Rút yêu cầu hoàn tiền?
        </h2>

        <p className="mt-3 text-body-sm text-ink-muted leading-relaxed">
          Sau khi rút, giao dịch này không thể gửi yêu cầu hoàn tiền lại.
          {eligible ? ` ${formatPoints(points)} Điểm sẽ trở lại Khả dụng.` : ""}
        </p>

        {error && (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <Button
            variant="outline"
            size="base"
            radius="field"
            disabled={withdrawing}
            onClick={onClose}
          >
            Đóng
          </Button>
          <Button
            variant="danger"
            size="base"
            radius="field"
            loading={withdrawing}
            loadingLabel="Đang rút…"
            disabled={withdrawing}
            onClick={() => {
              if (!withdrawing) onWithdraw();
            }}
          >
            Rút yêu cầu
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
