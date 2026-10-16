"use client";

import { useEffect, useRef, useState } from "react";
import type { PayosTopUpDto, TopUpRefundReason, UserTopUpRefundRequest } from "@rescom/schemas";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { TopUpStatusChip } from "@/components/wallet/TopUpStatusChip";
import { formatTime } from "@/lib/format/date-time";
import { formatPoints, formatVnd } from "@/lib/wallet/top-up";
import {
  formatVietnamDate,
  formatVietnamDateTime,
  ineligibleCopy,
  refundDestinationLabel,
  refundDueDate,
  refundDueLabel,
  refundReasonLabel,
  refundSectionView,
  refundUnavailableCopy,
} from "@/lib/wallet/top-up-refund";
import {
  requestPayosRefund,
  withdrawPayosRefund,
} from "@/lib/wallet/payos-top-up-service";
import { payosRefundErrorMessage } from "@/lib/wallet/payos-top-up-messages";
import { RefundConfirmDialog } from "./RefundConfirmDialog";
import { RefundForm } from "./RefundForm";
import { WithdrawRefundDialog } from "./WithdrawRefundDialog";

interface RefundSectionProps {
  topUp: PayosTopUpDto;
  sessionEmail?: string | null;
  onRefundSubmitted: (request: UserTopUpRefundRequest) => void;
  onRefundWithdrawn: () => void;
  recheck: () => void;
}

/**
 * Refund section on PayOS top-up detail (Story 13.11, AC 1, 2, 3, 5, 6; Figma A4, A5, A7).
 */
export function RefundSection({
  topUp,
  sessionEmail,
  onRefundSubmitted,
  onRefundWithdrawn,
  recheck,
}: RefundSectionProps) {
  const [now, setNow] = useState(() => new Date());

  // 60-second timer to update countdown and deadline check (AC 1)
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  const view = refundSectionView(topUp, now);

  // Form open/closed state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [pendingReason, setPendingReason] = useState<TopUpRefundReason | null>(null);
  const [pendingNote, setPendingNote] = useState("");
  const [serverFieldErrors, setServerFieldErrors] = useState<{
    reason?: string;
    note?: string;
  }>({});

  // Confirm submit dialog
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Withdraw dialog
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  // AC 7: conflict copy shown on the card after the dialog closes and the DTO reloads.
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  // Abort in-flight submit/withdraw on unmount (Guardrails).
  const requestController = useRef<AbortController | null>(null);
  useEffect(() => () => requestController.current?.abort(), []);
  const nextSignal = () => {
    requestController.current?.abort();
    requestController.current = new AbortController();
    return requestController.current.signal;
  };

  // Deadline passed (60 s tick) or a recheck moved the view: the confirm dialog
  // closes with the form so the user cannot submit against a stale view.
  const formAvailable = view.kind === "available";

  if (view.kind === "hidden") {
    return null;
  }

  const destination = topUp.refund?.request?.destination ?? topUp.refund?.destination ?? null;
  const destInfo = refundDestinationLabel(destination);

  // Submit Handler
  const handleConfirmSubmit = async () => {
    if (!pendingReason || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setConflictMessage(null);

    try {
      const result = await requestPayosRefund(
        topUp.id,
        { reason: pendingReason, note: pendingNote },
        nextSignal(),
      );
      setShowConfirmDialog(false);
      setIsFormOpen(false);
      onRefundSubmitted(result.request);
    } catch (err: unknown) {
      const parsed = payosRefundErrorMessage(err);
      if (parsed.fieldErrors && Object.keys(parsed.fieldErrors).length > 0) {
        setServerFieldErrors(parsed.fieldErrors);
        setShowConfirmDialog(false);
      } else if (!parsed.reload) {
        setSubmitError(parsed.message);
      }

      if (parsed.reload) {
        setConflictMessage(parsed.message);
        // The server state changed (already requested / not allowed): the
        // dialog would only invite another 409.
        setShowConfirmDialog(false);
        setIsFormOpen(false);
        recheck();
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Withdraw Handler
  const handleConfirmWithdraw = async () => {
    if (withdrawing) return;
    setWithdrawing(true);
    setWithdrawError(null);
    setConflictMessage(null);

    try {
      await withdrawPayosRefund(topUp.id, nextSignal());
      setShowWithdrawDialog(false);
      recheck();
      onRefundWithdrawn();
    } catch (err: unknown) {
      const parsed = payosRefundErrorMessage(err);
      if (parsed.reload) {
        setConflictMessage(parsed.message);
        setShowWithdrawDialog(false);
        recheck();
      } else {
        setWithdrawError(parsed.message);
      }
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {conflictMessage && (
        <Alert tone="info" onDismiss={() => setConflictMessage(null)}>
          {conflictMessage}
        </Alert>
      )}

      {/* 1. AVAILABLE VIEW */}
      {view.kind === "available" && (
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
          {isFormOpen ? (
            <RefundForm
              points={topUp.points}
              destination={destination}
              sessionEmail={sessionEmail}
              serverFieldErrors={serverFieldErrors}
              onFieldEdit={(field) =>
                setServerFieldErrors((prev) => ({ ...prev, [field]: undefined }))
              }
              onCancel={() => {
                setIsFormOpen(false);
                setServerFieldErrors({});
              }}
              onSubmit={(reason, note) => {
                setPendingReason(reason);
                setPendingNote(note);
                setServerFieldErrors({});
                setShowConfirmDialog(true);
              }}
            />
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-body font-bold text-ink">Hoàn tiền</h3>
                <TopUpStatusChip
                  chip={{
                    label: view.countdown,
                    icon: "clock",
                    tone: "teal",
                  }}
                />
              </div>

              <p className="text-caption text-ink-muted leading-relaxed">
                Bạn có thể yêu cầu hoàn{" "}
                <span className="font-semibold text-ink">
                  {formatVnd(topUp.amountVnd)}
                </span>{" "}
                đến {formatTime(view.deadline)} ngày {formatVietnamDate(view.deadline)}, nếu chưa tiêu Điểm nào
                kể từ lúc nạp. Tiền hoàn về đúng tài khoản đã thanh toán
                {destInfo.verified
                  ? ` (${destInfo.bank} · ${destInfo.accountNumber})`
                  : "; Admin sẽ xác minh qua email trước khi chuyển"}
                . Mỗi giao dịch chỉ gửi 1 lần.
              </p>

              <div>
                <Button
                  variant="outline"
                  size="base"
                  radius="field"
                  onClick={() => setIsFormOpen(true)}
                >
                  Yêu cầu hoàn tiền
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. UNAVAILABLE VIEW */}
      {view.kind === "unavailable" && (
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
          <h3 className="text-body font-bold text-ink">Hoàn tiền</h3>
          <p className="mt-2 text-caption text-ink-muted leading-relaxed">
            {refundUnavailableCopy(view.reason, { paidAt: topUp.paidAt })}
          </p>
        </div>
      )}

      {/* 3. REQUEST STATUS VIEW (A7) */}
      {view.kind === "request" && (
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
          {/* Status: REQUESTED */}
          {view.request.status === "REQUESTED" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-body font-bold text-ink">
                  {view.request.eligibility === "ELIGIBLE"
                    ? "Đang chờ Admin chuyển khoản"
                    : "Không đủ điều kiện hoàn tiền"}
                </h3>
              </div>

              {view.request.eligibility === "ELIGIBLE" ? (
                <>
                  <p className="text-caption text-ink-muted leading-relaxed">
                    <span className="font-semibold text-ink">
                      {formatPoints(view.request.points)} Điểm
                    </span>{" "}
                    đang được giữ và không dùng được cho tới khi có kết quả.
                  </p>

                  <dl className="divide-y divide-line text-caption">
                    <div className="flex justify-between py-2">
                      <dt className="text-ink-muted">Lý do</dt>
                      <dd className="font-medium text-ink">
                        {refundReasonLabel(view.request.reason)}
                      </dd>
                    </div>
                    <div className="flex justify-between py-2">
                      <dt className="text-ink-muted">Hoàn về tài khoản đã thanh toán</dt>
                      <dd className="text-right font-medium text-ink">
                        {destInfo.verified
                          ? `${destInfo.bank} · ${destInfo.accountNumber}`
                          : "Admin xác minh qua email"}
                      </dd>
                    </div>
                    {destInfo.verified && destInfo.holder && (
                      <div className="flex justify-between py-2">
                        <dt className="text-ink-muted">Chủ tài khoản</dt>
                        <dd className="font-medium text-ink">{destInfo.holder}</dd>
                      </div>
                    )}
                    <div className="flex justify-between py-2">
                      <dt className="text-ink-muted">Điểm đang giữ</dt>
                      <dd className="font-bold text-ink">
                        {formatPoints(view.request.points)} Điểm
                      </dd>
                    </div>
                    <div className="flex justify-between py-2">
                      <dt className="text-ink-muted">Hạn xử lý</dt>
                      <dd className="font-medium text-ink">
                        {formatVietnamDate(refundDueDate(view.request.submittedAt))} ·{" "}
                        <span
                          className={
                            refundDueLabel(view.request.submittedAt, now) === "Quá hạn"
                              ? "font-bold text-tone-danger-fg"
                              : "text-ink-muted"
                          }
                        >
                          {refundDueLabel(view.request.submittedAt, now)}
                        </span>
                      </dd>
                    </div>
                  </dl>
                </>
              ) : (
                <>
                  <p className="text-caption text-ink-muted leading-relaxed">
                    {ineligibleCopy(
                      view.request.ineligibleReason ?? "SPENT_SINCE_TOP_UP",
                    )}
                  </p>
                  <p className="text-caption text-ink-muted">
                    Admin sẽ phản hồi trước{" "}
                    <span className="font-medium text-ink">
                      {formatVietnamDate(refundDueDate(view.request.submittedAt))}
                    </span>
                    .
                  </p>
                  <dl className="divide-y divide-line text-caption">
                    <div className="flex justify-between py-2">
                      <dt className="text-ink-muted">Lý do</dt>
                      <dd className="font-medium text-ink">
                        {refundReasonLabel(view.request.reason)}
                      </dd>
                    </div>
                    <div className="flex justify-between py-2">
                      <dt className="text-ink-muted">Điểm đang giữ</dt>
                      <dd className="font-bold text-ink">0 Điểm</dd>
                    </div>
                    <div className="flex justify-between py-2">
                      <dt className="text-ink-muted">Tài khoản nhận</dt>
                      <dd className="text-right font-medium text-ink">
                        {destInfo.verified
                          ? `${destInfo.bank} · ${destInfo.accountNumber}`
                          : "Admin xác minh qua email"}
                      </dd>
                    </div>
                  </dl>
                </>
              )}

              <div className="pt-2">
                <Button
                  variant="danger-outline"
                  size="base"
                  radius="field"
                  onClick={() => setShowWithdrawDialog(true)}
                >
                  Rút yêu cầu
                </Button>
              </div>
            </div>
          )}

          {/* Status: REFUNDED */}
          {view.request.status === "REFUNDED" && (
            <div className="flex flex-col gap-4">
              <h3 className="text-body font-bold text-teal-800">
                Đã hoàn {formatVnd(view.request.amountVnd)} về tài khoản của bạn
              </h3>
              <p className="text-caption text-ink-muted leading-relaxed">
                Tiền đã chuyển về{" "}
                <span className="font-semibold text-ink">
                  {destInfo.verified
                    ? `${destInfo.bank} · ${destInfo.accountNumber}`
                    : "tài khoản đã thanh toán"}
                </span>
                {view.request.bankTransferredAt && (
                  <>
                    {" "}
                    lúc{" "}
                    <span className="font-medium text-ink">
                      {formatVietnamDateTime(view.request.bankTransferredAt)}
                    </span>
                  </>
                )}
                .{" "}
                <span className="font-semibold text-ink">
                  {formatPoints(view.request.points)} Điểm
                </span>{" "}
                đang giữ đã bị trừ.
              </p>

              <dl className="divide-y divide-line text-caption">
                <div className="flex justify-between py-2">
                  <dt className="text-ink-muted">Số Điểm đã trừ</dt>
                  <dd className="font-bold text-tone-danger-fg">
                    −{formatPoints(view.request.points)} Điểm
                  </dd>
                </div>
                {view.request.bankTransferReference && (
                  <div className="flex justify-between py-2">
                    <dt className="text-ink-muted">Mã chuyển khoản</dt>
                    <dd className="font-medium text-ink">
                      {view.request.bankTransferReference}
                    </dd>
                  </div>
                )}
                {view.request.bankTransferredAt && (
                  <div className="flex justify-between py-2">
                    <dt className="text-ink-muted">Thời gian chuyển</dt>
                    <dd className="font-medium text-ink">
                      {formatVietnamDateTime(view.request.bankTransferredAt)}
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          )}

          {/* Status: REJECTED */}
          {view.request.status === "REJECTED" && (
            <div className="flex flex-col gap-4">
              <h3 className="text-body font-bold text-tone-danger-fg">
                Yêu cầu hoàn tiền bị từ chối
              </h3>
              <p className="text-caption text-ink-muted leading-relaxed">
                {view.request.eligibility === "ELIGIBLE"
                  ? `${formatPoints(view.request.points)} Điểm đã trả lại Khả dụng. Mỗi giao dịch chỉ gửi yêu cầu 1 lần nên không gửi lại được.`
                  : "Không có Điểm nào bị giữ. Mỗi giao dịch chỉ gửi yêu cầu 1 lần nên không gửi lại được."}
              </p>

              {view.request.rejectionReason && (
                <div className="rounded-xl border border-line bg-slate-50 p-3 text-caption text-ink">
                  <span className="font-bold text-ink-muted">Lý do của Admin:</span>{" "}
                  {view.request.rejectionReason}
                </div>
              )}

              {view.request.resolvedAt && (
                <dl className="divide-y divide-line text-caption">
                  <div className="flex justify-between py-2">
                    <dt className="text-ink-muted">Thời điểm từ chối</dt>
                    <dd className="font-medium text-ink">
                      {formatVietnamDateTime(view.request.resolvedAt)}
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          )}

          {/* Status: WITHDRAWN */}
          {view.request.status === "WITHDRAWN" && (
            <div className="flex flex-col gap-3">
              <h3 className="text-body font-bold text-ink">
                Đã rút yêu cầu hoàn tiền
              </h3>
              <p className="text-caption text-ink-muted leading-relaxed">
                Bạn đã rút yêu cầu hoàn tiền
                {view.request.withdrawnAt
                  ? ` lúc ${formatVietnamDateTime(view.request.withdrawnAt)}`
                  : ""}
                . Giao dịch này không thể yêu cầu hoàn tiền nữa.
                {view.request.eligibility === "ELIGIBLE"
                  ? ` ${formatPoints(view.request.points)} Điểm đã trở lại Khả dụng.`
                  : ""}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Dialogs */}
      {pendingReason && (
        <RefundConfirmDialog
          open={showConfirmDialog && (formAvailable || submitting)}
          submitting={submitting}
          error={submitError}
          amountVnd={topUp.amountVnd}
          points={topUp.points}
          orderCode={topUp.orderCode}
          paidAt={topUp.paidAt}
          reason={pendingReason}
          destination={destination}
          sessionEmail={sessionEmail}
          onClose={() => {
            setShowConfirmDialog(false);
            setSubmitError(null);
          }}
          onSubmit={handleConfirmSubmit}
        />
      )}

      {view.kind === "request" && (
        <WithdrawRefundDialog
          open={showWithdrawDialog}
          withdrawing={withdrawing}
          error={withdrawError}
          points={view.request.points}
          eligible={view.request.eligibility === "ELIGIBLE"}
          onClose={() => {
            setShowWithdrawDialog(false);
            setWithdrawError(null);
          }}
          onWithdraw={handleConfirmWithdraw}
        />
      )}
    </div>
  );
}
