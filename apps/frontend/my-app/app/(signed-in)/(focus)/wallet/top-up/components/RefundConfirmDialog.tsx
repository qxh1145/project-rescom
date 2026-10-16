"use client";

import type { TopUpRefundReason, UserTopUpRefundDestinationView } from "@rescom/schemas";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Icon } from "@/components/ui/Icon";
import { formatShortDateTime } from "@/lib/format/date-time";
import { formatPoints, formatVnd } from "@/lib/wallet/top-up";
import {
  refundDestinationLabel,
  refundReasonLabel,
} from "@/lib/wallet/top-up-refund";

interface RefundConfirmDialogProps {
  open: boolean;
  submitting: boolean;
  error: string | null;
  amountVnd: number;
  points: number;
  orderCode: number;
  paidAt: Date | string | null;
  reason: TopUpRefundReason;
  destination: UserTopUpRefundDestinationView | null | undefined;
  sessionEmail?: string | null;
  onClose: () => void;
  onSubmit: () => void;
}

/**
 * Refund confirmation dialog (Story 13.11, AC 3; Figma 186:2339, submitting 186:2554).
 */
export function RefundConfirmDialog({
  open,
  submitting,
  error,
  amountVnd,
  points,
  orderCode,
  paidAt,
  reason,
  destination,
  sessionEmail,
  onClose,
  onSubmit,
}: RefundConfirmDialogProps) {
  const destInfo = refundDestinationLabel(destination);
  const paidTimeText = formatShortDateTime(paidAt);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      labelledBy="refund-confirm-dialog-title"
      width={480}
      dismissible={!submitting}
    >
      <div className="flex flex-col p-6">
        <h2
          id="refund-confirm-dialog-title"
          className="text-title-sm font-bold text-ink"
        >
          Gửi yêu cầu hoàn {formatVnd(amountVnd)}?
        </h2>
        <p className="mt-1 text-caption text-ink-muted">
          Giao dịch #{orderCode}
          {paidTimeText ? ` · nạp ${paidTimeText}` : ""}
        </p>

        {error && (
          <Alert tone="danger" className="mt-4">
            {error}
          </Alert>
        )}

        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-line bg-slate-50 p-4 text-caption text-ink">
          {/* Row 1: Hold explanation */}
          <div className="flex items-start gap-2.5">
            <Icon name="lock" size={16} className="mt-0.5 shrink-0 text-ink-muted" />
            <p>
              Nếu hợp lệ,{" "}
              <span className="font-bold">{formatPoints(points)} Điểm</span> chuyển
              sang “Giữ chờ hoàn tiền” và không dùng được cho tới khi Admin xử lý
              (tối đa 3 ngày làm việc).
            </p>
          </div>

          {/* Row 2: Destination */}
          <div className="flex items-start gap-2.5">
            <Icon name="bank" size={16} className="mt-0.5 shrink-0 text-ink-muted" />
            <p>
              {destInfo.verified ? (
                <>
                  Hoàn {formatVnd(amountVnd)} về{" "}
                  <span className="font-bold">
                    {destInfo.bank} · {destInfo.accountNumber}
                  </span>{" "}
                  — đúng tài khoản đã thanh toán lần nạp này.
                </>
              ) : (
                <>
                  Admin sẽ xác minh tài khoản nhận qua email{" "}
                  <span className="font-bold">{sessionEmail ?? "của bạn"}</span> trước
                  khi chuyển.
                </>
              )}
            </p>
          </div>

          {/* Row 3: Once-only warning */}
          <div className="flex items-start gap-2.5">
            <Icon
              name="alert-triangle"
              size={16}
              className="mt-0.5 shrink-0 text-tone-amber-fg"
            />
            <p className="font-medium text-tone-amber-fg">
              Mỗi giao dịch chỉ gửi 1 lần. Nếu bị từ chối, bạn không gửi lại được.
            </p>
          </div>

          {/* Row 4: Reason */}
          <div className="flex items-start gap-2.5 border-t border-line/50 pt-2 text-ink-muted">
            <Icon name="info" size={16} className="mt-0.5 shrink-0" />
            <p>
              Lý do: <span className="font-medium text-ink">{refundReasonLabel(reason)}</span>
            </p>
          </div>
        </div>

        {submitting && (
          <p className="mt-4 text-center text-caption font-medium text-ink-muted animate-pulse">
            Đang kiểm tra điều kiện và gửi yêu cầu… Không đóng cửa sổ.
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <Button
            variant="outline"
            size="base"
            radius="field"
            disabled={submitting}
            onClick={onClose}
          >
            Huỷ
          </Button>
          <Button
            variant="primary"
            size="base"
            radius="field"
            loading={submitting}
            disabled={submitting}
            onClick={() => {
              if (!submitting) onSubmit();
            }}
          >
            Gửi yêu cầu
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
