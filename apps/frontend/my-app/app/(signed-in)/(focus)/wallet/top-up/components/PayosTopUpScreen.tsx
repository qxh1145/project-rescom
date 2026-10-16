"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PayosTopUpDto, UserTopUpRefundRequest, WalletBalanceDto } from "@rescom/schemas";
import { Mascot } from "@/components/brand/Mascot";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Dialog } from "@/components/ui/Dialog";
import { formatPoints, formatVnd } from "@/lib/wallet/top-up";
import {
  isSafeCheckoutUrl,
  payosTimeline,
  shouldPoll,
} from "@/lib/wallet/payos-top-up";
import { cancelPayosTopUp } from "@/lib/wallet/payos-top-up-service";
import { payosCancelErrorMessage } from "@/lib/wallet/payos-top-up-messages";
import { getWalletBalance } from "@/lib/wallet/wallet-service";
import { isApiMockingEnabled } from "@/lib/api/config";
import { useSession } from "@/lib/session/SessionProvider";
import { usePayosPolling } from "@/lib/wallet/use-payos-polling";
import { MANUAL_REFUNDED_COPY, topUpChip } from "@/lib/wallet/top-up-history";
import {
  refundSectionView,
  refundTimelineSteps,
} from "@/lib/wallet/top-up-refund";
import { TopUpStatusChip } from "@/components/wallet/TopUpStatusChip";
import { TopUpFrame } from "./TopUpFrame";
import { RefundSection } from "./RefundSection";
import { RefundResult } from "./RefundResult";

interface PayosTopUpScreenProps {
  initialTopUp: PayosTopUpDto;
}

export function PayosTopUpScreen({ initialTopUp }: PayosTopUpScreenProps) {
  const { user, refresh: refreshSession } = useSession();
  const sessionEmail = user?.email ?? null;
  const { topUp: currentTopUp, state: pollState, recheck } = usePayosPolling(
    initialTopUp.id,
    initialTopUp,
    // Terminal: refresh the header chip / session balance like WalletScreen does.
    () => refreshSession(),
  );

  const topUp = currentTopUp ?? initialTopUp;
  const timedOut =
    topUp.status === "PROCESSING" && (pollState === "timed-out" || !shouldPoll(topUp));

  // Local refund submission result view (A6)
  const [refundResult, setRefundResult] = useState<UserTopUpRefundRequest | null>(null);

  // AC8: show the new balance on the SUCCESSFUL view.
  const [newBalance, setNewBalance] = useState<WalletBalanceDto | null>(null);
  useEffect(() => {
    if (topUp.status !== "SUCCESSFUL") return;
    const controller = new AbortController();
    getWalletBalance(controller.signal)
      .then(setNewBalance)
      .catch(() => undefined);
    return () => controller.abort();
  }, [topUp.status]);
  const chip = topUpChip(topUp.status, "PAYOS", topUp.refund?.request?.status);
  const timeline = [
    ...payosTimeline(topUp),
    ...(topUp.refund?.request ? refundTimelineSteps(topUp.refund.request) : []),
  ];

  // Countdown timer for PROCESSING
  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    const diff = Math.max(
      0,
      Math.floor((new Date(topUp.expiresAt).getTime() - Date.now()) / 1000),
    );
    return diff;
  });

  useEffect(() => {
    if (topUp.status !== "PROCESSING") return;
    const interval = setInterval(() => {
      const diff = Math.max(
        0,
        Math.floor((new Date(topUp.expiresAt).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(diff);
    }, 1000);
    return () => clearInterval(interval);
  }, [topUp.status, topUp.expiresAt]);

  // Cancel dialog
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const handleCancel = async () => {
    setCancelling(true);
    setCancelError(null);
    try {
      await cancelPayosTopUp(topUp.id);
      setShowCancelDialog(false);
      recheck();
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === "TOPUP_NOT_CANCELLABLE") {
        // Status changed under us: close and show the real status.
        setShowCancelDialog(false);
        recheck();
      } else {
        setCancelError(payosCancelErrorMessage(err));
      }
    } finally {
      setCancelling(false);
    }
  };

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const countdownFormatted = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  const refundView = refundSectionView(topUp);
  const hasRefundSection = refundView.kind !== "hidden";
  const frameWidth = refundResult ? 720 : hasRefundSection ? 1080 : 720;

  const mainDetails = (
    <div className="flex flex-col gap-6">
      {/* Header Status Card */}
          <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-surface p-6 text-center shadow-xs">
            {topUp.status === "PROCESSING" && (
              <>
                <Mascot name="wait" height={100} className="mb-2" />
                <h2 className="text-[20px] font-bold text-ink">
                  Đang chờ thanh toán
                </h2>
                <p className="mt-1 text-body-sm text-ink-muted">
                  Thời gian còn lại để thanh toán:{" "}
                  <span className="font-extrabold text-tone-amber-fg">
                    {countdownFormatted}
                  </span>
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                  {isSafeCheckoutUrl(topUp.checkoutUrl, isApiMockingEnabled) && (
                    <a
                      href={topUp.checkoutUrl}
                      className="inline-flex h-11 items-center justify-center rounded-field bg-primary px-5 text-body-sm font-bold text-primary-foreground hover:bg-primary-strong transition-colors"
                    >
                      Tiếp tục thanh toán
                    </a>
                  )}
                  <Button
                    variant="secondary"
                    size="base"
                    radius="field"
                    onClick={() => setShowCancelDialog(true)}
                  >
                    Huỷ giao dịch
                  </Button>
                  <Button variant="secondary" size="base" radius="field" onClick={recheck}>
                    Kiểm tra lại
                  </Button>
                </div>
              </>
            )}

            {topUp.status === "SUCCESSFUL" && (
              <>
                <Mascot name="points" height={100} className="mb-2" />
                <h2 className="text-[22px] font-extrabold text-ink">
                  Nạp thành công +{formatPoints(topUp.points)} Điểm!
                </h2>
                <p className="mt-1 text-body-sm text-ink-muted">
                  Điểm đã được cộng vào số dư Khả dụng của bạn.
                </p>
                {newBalance && (
                  <p className="mt-2 text-body-sm font-bold text-ink">
                    Số dư mới: {formatPoints(newBalance.available)} điểm
                  </p>
                )}
                <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                  <Link
                    href="/wallet"
                    className={buttonClassName({ variant: "secondary", size: "base", radius: "field" })}
                  >
                    Về ví
                  </Link>
                  <Link
                    href="/forms/new"
                    className={buttonClassName({ size: "base", radius: "field" })}
                  >
                    Đăng khảo sát
                  </Link>
                </div>
              </>
            )}

            {topUp.status === "CANCELLED" && (
              <>
                <h2 className="text-[20px] font-bold text-ink">
                  Giao dịch đã huỷ
                </h2>
                <p className="mt-1 text-caption text-ink-muted leading-relaxed">
                  Giao dịch này đã được huỷ. Nếu bạn đã thanh toán, Điểm vẫn sẽ được cộng sau khi hệ thống đối soát.
                </p>
                <div className="mt-4 flex items-center justify-center gap-3">
                  <Link
                    href="/wallet/top-up"
                    className={buttonClassName({ size: "base", radius: "field" })}
                  >
                    Tạo mã mới
                  </Link>
                  <Button variant="secondary" size="base" radius="field" onClick={recheck}>
                    Kiểm tra lại
                  </Button>
                </div>
              </>
            )}

            {topUp.status === "EXPIRED" && (
              <>
                <h2 className="text-[20px] font-bold text-ink">
                  Mã thanh toán đã hết hạn
                </h2>
                <p className="mt-1 text-caption text-ink-muted leading-relaxed">
                  Mã thanh toán quá hạn 5 phút. Nếu bạn đã thanh toán, Điểm vẫn sẽ được cộng.
                </p>
                <div className="mt-4 flex items-center justify-center gap-3">
                  <Link
                    href="/wallet/top-up"
                    className={buttonClassName({ size: "base", radius: "field" })}
                  >
                    Tạo mã mới
                  </Link>
                  <Button variant="secondary" size="base" radius="field" onClick={recheck}>
                    Kiểm tra lại
                  </Button>
                </div>
              </>
            )}

            {topUp.status === "AMOUNT_MISMATCH" && (
              <>
                <h2 className="text-[20px] font-bold text-tone-amber-fg">
                  Sai lệch số tiền thanh toán
                </h2>
                <p className="mt-2 text-caption text-ink-muted leading-relaxed">
                  Hệ thống ghi nhận số tiền chuyển khoản không khớp với số tiền đã tạo. Admin sẽ xử lý trong 3 ngày làm việc.
                </p>
                <div className="mt-4">
                  <Link
                    href="/wallet"
                    className={buttonClassName({ variant: "secondary", size: "base", radius: "field" })}
                  >
                    Về Ví điểm
                  </Link>
                </div>
              </>
            )}

            {topUp.status === "MANUAL_REFUNDED" && (
              <>
                <h2 className="text-[20px] font-bold text-teal-800">
                  Đã hoàn tiền thủ công
                </h2>
                <p className="mt-2 text-caption text-ink-muted leading-relaxed">
                  {MANUAL_REFUNDED_COPY}
                </p>
                <div className="mt-4">
                  <Link
                    href="/wallet"
                    className={buttonClassName({ variant: "secondary", size: "base", radius: "field" })}
                  >
                    Về Ví điểm
                  </Link>
                </div>
              </>
            )}

            {timedOut && (
              <div className="mt-4 w-full rounded-xl bg-slate-50 p-3 text-caption text-ink-muted border border-line">
                Đã quá thời gian chờ nhận diện thanh toán tự động. Nếu bạn đã thanh toán, Điểm vẫn sẽ được cộng.
              </div>
            )}

            {pollState === "error" && !timedOut && topUp.status === "PROCESSING" && (
              <Alert tone="danger" className="mt-4 w-full text-left">
                Không cập nhật được trạng thái tự động. Hãy bấm &quot;Kiểm tra lại&quot; hoặc thử lại sau ít phút.
              </Alert>
            )}
          </div>

          {/* Info Details Table */}
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
            <h3 className="text-body font-bold text-ink">Thông tin giao dịch</h3>
            <dl className="mt-3 divide-y divide-line text-caption">
              <div className="flex justify-between py-2.5">
                <dt className="text-ink-muted">Mã đơn hàng</dt>
                <dd className="font-bold text-ink">{topUp.orderCode}</dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-ink-muted">Số tiền nạp</dt>
                <dd className="font-extrabold text-ink">{formatVnd(topUp.amountVnd)}</dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-ink-muted">Số Điểm nhận</dt>
                <dd className="font-extrabold text-primary">+{formatPoints(topUp.points)} Điểm</dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-ink-muted">Kênh thanh toán</dt>
                <dd className="font-bold text-ink">PayOS (VietQR)</dd>
              </div>
              <div className="flex justify-between py-2.5">
                <dt className="text-ink-muted">Thời gian tạo</dt>
                <dd className="text-ink">{new Date(topUp.createdAt).toLocaleString("vi-VN")}</dd>
              </div>
              {topUp.paidAt && (
                <div className="flex justify-between py-2.5">
                  <dt className="text-ink-muted">Thời gian thanh toán</dt>
                  <dd className="text-ink">{new Date(topUp.paidAt).toLocaleString("vi-VN")}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* Status Timeline */}
          <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
            <h3 className="text-body font-bold text-ink">Tiến trình giao dịch</h3>
            <div className="mt-4 flex flex-col gap-4">
              {timeline.map((step, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                        step.state === "done"
                          ? "bg-primary text-primary-foreground"
                          : step.state === "current"
                          ? "bg-tone-amber-accent text-ink"
                          : step.state === "failed"
                          ? "bg-tone-danger-bg text-tone-danger-fg"
                          : "bg-slate-100 text-ink-muted"
                      }`}
                    >
                      {idx + 1}
                    </span>
                    {idx < timeline.length - 1 && (
                      <span className="my-1 h-6 w-0.5 bg-line" />
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="text-body-sm font-bold text-ink">
                      {step.title}
                    </span>
                    <span className="text-caption text-ink-muted">
                      {step.detail}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
  );

  return (
    <>
      <TopUpFrame
        mobileTitle="Chi tiết nạp điểm"
        exitHref="/wallet"
        width={frameWidth}
        desktopHeader={
          <div className="flex items-center justify-between">
            <div>
              <h1 id="top-up-dialog-title" className="text-[22px] font-extrabold text-ink">
                Giao dịch PayOS #{topUp.orderCode}
              </h1>
              <p className="mt-1 text-body-sm text-ink-muted">
                Tạo lúc {new Date(topUp.createdAt).toLocaleString("vi-VN")}
              </p>
            </div>
            <TopUpStatusChip chip={chip} />
          </div>
        }
      >
        {refundResult ? (
          <RefundResult
            request={refundResult}
            orderCode={topUp.orderCode}
            availableBalance={newBalance?.available ?? null}
            onViewTransaction={() => setRefundResult(null)}
          />
        ) : hasRefundSection ? (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_384px] gap-6 lg:mt-4">
            {mainDetails}
            <div className="flex flex-col">
              <RefundSection
                topUp={topUp}
                sessionEmail={sessionEmail}
                onRefundSubmitted={(req) => {
                  recheck();
                  refreshSession();
                  setRefundResult(req);
                  // Drop the pre-hold balance so A6 never shows a stale "Khả dụng còn".
                  setNewBalance(null);
                  getWalletBalance().then(setNewBalance).catch(() => undefined);
                }}
                onRefundWithdrawn={() => {
                  recheck();
                  refreshSession();
                }}
                recheck={recheck}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6 lg:mt-4">
            {mainDetails}
          </div>
        )}
      </TopUpFrame>

      {/* Cancel Dialog */}
      <Dialog
        open={showCancelDialog && topUp.status === "PROCESSING"} // closes itself once terminal
        onClose={() => setShowCancelDialog(false)}
        labelledBy="cancel-dialog-title"
        width={480}
      >
        <div className="flex flex-col p-6">
          <h2 id="cancel-dialog-title" className="text-body font-bold text-ink">
            Huỷ giao dịch nạp điểm?
          </h2>
          <p className="mt-2 text-caption text-ink-muted leading-relaxed">
            Nếu bạn đã thanh toán, Điểm vẫn sẽ được cộng sau khi hệ thống đối soát. Bạn có chắc muốn huỷ giao dịch này?
          </p>
          {cancelError && (
            <Alert tone="danger" className="mt-3">
              {cancelError}
            </Alert>
          )}
          <div className="mt-6 flex items-center justify-end gap-2.5">
            <Button
              variant="secondary"
              size="base"
              radius="field"
              onClick={() => setShowCancelDialog(false)}
              disabled={cancelling}
            >
              Đóng
            </Button>
            <Button
              variant="danger"
              size="base"
              radius="field"
              onClick={handleCancel}
              loading={cancelling}
              loadingLabel="Đang huỷ…"
            >
              Xác nhận huỷ
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
