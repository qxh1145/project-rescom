"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClassName } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { ToggleChip } from "@/components/ui/ToggleChip";
import { Dialog } from "@/components/ui/Dialog";
import { Spinner } from "@/components/ui/Spinner";
import { useSession } from "@/lib/session/SessionProvider";
import {
  PAYOS_QUICK_AMOUNTS,
  checkPayosAmount,
  isSafeCheckoutUrl,
  pointsForVnd,
} from "@/lib/wallet/payos-top-up";
import { isApiMockingEnabled } from "@/lib/api/config";
import { formatPoints, formatVnd } from "@/lib/wallet/top-up";
import {
  createPayosCheckout,
  cancelPayosTopUp,
  getPayosTopUp,
  listPayosTopUps,
} from "@/lib/wallet/payos-top-up-service";
import {
  payosCancelErrorMessage,
  payosCheckoutErrorMessage,
} from "@/lib/wallet/payos-top-up-messages";
import type { PayosTopUpDto } from "@rescom/schemas";
import { TopUpFrame } from "./TopUpFrame";

const FORM_ID = "payos-checkout-form";
const MAX_AMOUNT_DIGITS = 9;
const VND_FORMAT = new Intl.NumberFormat("vi-VN");

/** Zod `error.format()` 400 details carry `amountVnd._errors` when the amount is rejected. */
function hasAmountFieldError(err: unknown): boolean {
  const details = (err as { details?: unknown })?.details;
  if (typeof details !== "object" || details === null) return false;
  const entry = (details as Record<string, unknown>).amountVnd as { _errors?: unknown[] } | undefined;
  return Array.isArray(entry?._errors) && entry._errors.length > 0;
}

export function PayosCheckoutScreen() {
  const { balance } = useSession();
  const [amountStr, setAmountStr] = useState<string>("50.000");
  const [selectedQuick, setSelectedQuick] = useState<number | null>(50_000);
  const [touched, setTouched] = useState(false);

  const [blockedTopUp, setBlockedTopUp] = useState<PayosTopUpDto | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [amountServerError, setAmountServerError] = useState<string | null>(null);

  // Cancel dialog state
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Find the PROCESSING row (blocks creating a new top-up). Optionally by known id first.
  const loadProcessing = useCallback(async (topUpId?: string): Promise<PayosTopUpDto | null> => {
    if (topUpId) {
      try {
        const row = await getPayosTopUp(topUpId);
        if (row.status === "PROCESSING") return row;
      } catch {
        // fall through to the list lookup
      }
    }
    try {
      const res = await listPayosTopUps({ limit: 20 });
      return res.items.find((item) => item.status === "PROCESSING") ?? null;
    } catch {
      return null;
    }
  }, []);

  // Check for currently PROCESSING top-up on mount
  useEffect(() => {
    let cancelled = false;
    loadProcessing()
      .then((row) => {
        if (!cancelled && row) setBlockedTopUp(row);
      })
      .finally(() => {
        if (!cancelled) setLoadingInitial(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadProcessing]);

  // bfcache: Back from PayOS restores this page with redirecting/submitting stuck true.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setRedirecting(false);
        setSubmitting(false);
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const validation = checkPayosAmount(amountStr);
  const validAmount = validation.ok ? validation.amountVnd : null;
  const inlineError =
    amountServerError ?? (!validation.ok && touched ? validation.message : undefined);
  const suggestion = !validation.ok && touched ? validation.suggestion : undefined;

  const pointsPreview = validAmount ? pointsForVnd(validAmount) : null;

  const handleAmountChange = (val: string) => {
    const digits = val.replace(/\D/g, "").slice(0, MAX_AMOUNT_DIGITS);
    setAmountStr(digits ? VND_FORMAT.format(Number(digits)) : "");
    setSelectedQuick(null);
    setServerError(null);
    setAmountServerError(null);
  };

  const handleSelectQuick = (amount: number) => {
    setSelectedQuick(amount);
    setAmountStr(new Intl.NumberFormat("vi-VN").format(amount));
    setTouched(true);
    setServerError(null);
    setAmountServerError(null);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!validAmount || blockedTopUp || loadingInitial) return;

    setSubmitting(true);
    setServerError(null);
    setAmountServerError(null);

    let result: Awaited<ReturnType<typeof createPayosCheckout>>;
    try {
      result = await createPayosCheckout(validAmount);
    } catch (err: unknown) {
      setSubmitting(false);
      const apiErr = err as { code?: string; status?: number; details?: { topUpId?: string } };
      if (apiErr?.code === "TOPUP_ALREADY_PROCESSING" || apiErr?.status === 409) {
        const row = await loadProcessing(apiErr.details?.topUpId);
        if (row) {
          setBlockedTopUp(row);
          return;
        }
      } else if (apiErr?.code === "VALIDATION_ERROR" && hasAmountFieldError(err)) {
        setAmountServerError(payosCheckoutErrorMessage(err));
        return;
      }
      setServerError(payosCheckoutErrorMessage(err));
      return;
    }

    // The PROCESSING row now exists server-side: never claim "not charged" or invite a blind retry.
    if (!isSafeCheckoutUrl(result.checkoutUrl, isApiMockingEnabled)) {
      setSubmitting(false);
      setBlockedTopUp(result.topUp);
      setServerError(
        "Giao dịch đã được tạo nhưng địa chỉ thanh toán không hợp lệ. Bạn có thể đang có một giao dịch chờ thanh toán — vui lòng xem hoặc huỷ giao dịch bên dưới.",
      );
      return;
    }
    setRedirecting(true);
    window.location.assign(result.checkoutUrl);
  };

  const handleCancelTopUp = async () => {
    if (!blockedTopUp) return;
    setCancelling(true);
    setCancelError(null);

    try {
      await cancelPayosTopUp(blockedTopUp.id);
      setBlockedTopUp(null);
      setShowCancelDialog(false);
    } catch (err: unknown) {
      const apiErr = err as { code?: string };
      if (apiErr?.code === "TOPUP_NOT_CANCELLABLE") {
        // Status changed under us: reload the real status instead of guessing.
        setShowCancelDialog(false);
        const row = await loadProcessing(blockedTopUp.id);
        setBlockedTopUp(row);
      } else {
        setCancelError(payosCancelErrorMessage(err));
      }
    } finally {
      setCancelling(false);
    }
  };

  const cta = blockedTopUp ? null : (
    <Button
      type="submit"
      form={FORM_ID}
      size="lg"
      radius="field"
      fullWidth
      loading={submitting || redirecting}
      disabled={!validation.ok || submitting || redirecting || loadingInitial}
      loadingLabel={redirecting ? "Đang chuyển đến PayOS…" : "Đang tạo mã thanh toán…"}
    >
      Thanh toán qua PayOS
    </Button>
  );

  return (
    <>
      <TopUpFrame
        mobileTitle="Nạp điểm qua PayOS"
        exitHref="/wallet"
        width={600}
        desktopHeader={
          <>
            <h1 id="top-up-dialog-title" className="text-[22px] font-extrabold text-ink">
              Nạp điểm qua PayOS
            </h1>
            <p className="mt-1 text-body-sm text-ink-muted">
              Quét mã VietQR chuyển khoản nhanh 24/7.
            </p>
          </>
        }
        mobileFooter={cta}
      >
        {redirecting && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/60 p-6 backdrop-blur-xs">
            <div className="flex flex-col items-center gap-4 rounded-2xl bg-surface p-8 shadow-xl">
              <Spinner className="size-8 text-primary" />
              <p className="text-body font-bold text-ink">
                Đang chuyển đến cổng thanh toán PayOS…
              </p>
              <p className="text-caption text-ink-muted">
                Vui lòng không tắt trình duyệt
              </p>
            </div>
          </div>
        )}

        <form id={FORM_ID} onSubmit={handleSubmit} noValidate className="flex flex-col lg:mt-6">
          <p className="text-label font-normal text-ink-muted">Số dư khả dụng</p>
          <p className="text-[30px] font-extrabold text-ink">
            {balance ? `${formatPoints(balance.available)} điểm` : "Chưa có"}
          </p>

          {blockedTopUp ? (
            <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-tone-amber-accent/50 bg-tone-amber-bg p-5 text-ink">
              <div className="flex flex-col gap-1">
                <span className="text-body font-bold text-tone-amber-fg">
                  Bạn đang có giao dịch chờ thanh toán
                </span>
                <span className="text-caption text-ink">
                  Mã giao dịch: {blockedTopUp.orderCode || blockedTopUp.id.slice(0, 8)} • Số tiền:{" "}
                  {formatVnd(blockedTopUp.amountVnd)}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2">
                {isSafeCheckoutUrl(blockedTopUp.checkoutUrl, isApiMockingEnabled) && (
                  <a
                    href={blockedTopUp.checkoutUrl}
                    className="inline-flex h-10 items-center justify-center rounded-field bg-primary px-4 text-label font-bold text-primary-foreground hover:bg-primary-strong transition-colors"
                  >
                    Tiếp tục thanh toán
                  </a>
                )}
                <Link
                  href={`/wallet/top-up/${encodeURIComponent(blockedTopUp.id)}`}
                  className={buttonClassName({ variant: "secondary", size: "sm", radius: "field" })}
                >
                  Xem giao dịch
                </Link>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  radius="field"
                  onClick={() => setShowCancelDialog(true)}
                >
                  Huỷ giao dịch
                </Button>
              </div>
            </div>
          ) : null}

          <div className="mt-4 flex flex-col gap-3">
            <label htmlFor="payos-amount-input" className="text-body font-bold text-ink">
              Chọn số tiền nạp
            </label>

            <div className="flex flex-wrap gap-2">
              {PAYOS_QUICK_AMOUNTS.map((quick) => (
                <ToggleChip
                  key={quick}
                  selected={selectedQuick === quick}
                  onSelectedChange={() => handleSelectQuick(quick)}
                  disabled={blockedTopUp !== null || loadingInitial}
                >
                  {formatVnd(quick)}
                </ToggleChip>
              ))}
            </div>

            <TextField
              id="payos-amount-input"
              className="mt-2"
              label="Hoặc nhập số tiền (VNĐ)"
              inputMode="numeric"
              autoComplete="off"
              placeholder="Ví dụ: 100.000"
              value={amountStr}
              onChange={(e) => handleAmountChange(e.target.value)}
              onBlur={() => setTouched(true)}
              disabled={blockedTopUp !== null || loadingInitial}
              maxLength={11}
              error={inlineError}
            />

            {suggestion !== undefined && (
              <p className="text-caption text-ink-muted">
                Gợi ý số tiền gần nhất:{" "}
                <button
                  type="button"
                  onClick={() => handleSelectQuick(suggestion)}
                  className="font-bold text-primary underline"
                >
                  {formatVnd(suggestion)}
                </button>
              </p>
            )}
          </div>

          <dl className="mt-4.5 flex flex-col gap-1.5 rounded-2xl border border-line bg-surface px-4 py-3.5">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-label font-normal text-ink-muted">Bạn sẽ nhận</dt>
              <dd className="text-label font-bold text-ink">
                {pointsPreview !== null ? `${formatPoints(pointsPreview)} điểm` : "—"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-label font-normal text-ink-muted">Tỷ giá quy đổi</dt>
              <dd className="text-caption text-ink-muted">1 điểm = 200đ</dd>
            </div>
          </dl>

          <p className="mt-4 text-caption leading-relaxed text-ink-muted">
            • Mã QR có hiệu lực 5 phút. Vui lòng thanh toán trong thời gian này.<br />
            • Nạp là một chiều: Điểm không đổi lại thành tiền mặt và không chuyển nhượng.
          </p>

          {serverError && (
            <Alert tone="danger" className="mt-4">
              {serverError}
            </Alert>
          )}

          <div className="mt-6 hidden items-center justify-end gap-3 border-t border-line-subtle pt-4 lg:flex">
            <Link
              href="/wallet"
              className={buttonClassName({ variant: "secondary", size: "base", radius: "field" })}
            >
              Để sau
            </Link>
            {!blockedTopUp && (
              <Button
                type="submit"
                size="base"
                radius="field"
                loading={submitting || redirecting}
                disabled={!validation.ok || submitting || redirecting || loadingInitial}
                loadingLabel={redirecting ? "Đang chuyển đến PayOS…" : "Đang tạo mã thanh toán…"}
              >
                Thanh toán qua PayOS
              </Button>
            )}
          </div>
        </form>
      </TopUpFrame>

      {/* Confirm Cancel Dialog */}
      <Dialog
        open={showCancelDialog}
        onClose={() => setShowCancelDialog(false)}
        labelledBy="cancel-dialog-title"
        width={480}
      >
        <div className="flex flex-col p-6">
          <h2 id="cancel-dialog-title" className="text-body font-bold text-ink">
            Huỷ giao dịch nạp điểm?
          </h2>
          <p className="mt-2 text-caption text-ink-muted leading-relaxed">
            Nếu bạn đã chuyển khoản, Điểm vẫn sẽ được cộng sau khi hệ thống ghi nhận.
            Bạn có chắc chắn muốn huỷ giao dịch này để tạo mới?
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
              onClick={handleCancelTopUp}
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
