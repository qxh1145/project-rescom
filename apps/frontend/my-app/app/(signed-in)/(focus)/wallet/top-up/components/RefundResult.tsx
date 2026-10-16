"use client";

import Link from "next/link";
import type { UserTopUpRefundRequest } from "@rescom/schemas";
import { Mascot } from "@/components/brand/Mascot";
import { Button, buttonClassName } from "@/components/ui/Button";
import { formatPoints, formatVnd } from "@/lib/wallet/top-up";
import {
  formatVietnamDate,
  ineligibleCopy,
  refundDestinationLabel,
  refundDueDate,
} from "@/lib/wallet/top-up-refund";
import { TopUpStatusChip } from "@/components/wallet/TopUpStatusChip";

interface RefundResultProps {
  request: UserTopUpRefundRequest;
  orderCode: number;
  availableBalance: number | null;
  onViewTransaction: () => void;
}

/**
 * Refund submission result view (Story 13.11, AC 4; Figma 186:2756 / 186:2897).
 */
export function RefundResult({
  request,
  orderCode,
  availableBalance,
  onViewTransaction,
}: RefundResultProps) {
  const isEligible = request.eligibility === "ELIGIBLE";
  const destInfo = refundDestinationLabel(request.destination);
  const dueFormatted = formatVietnamDate(refundDueDate(request.submittedAt));

  return (
    <div className="flex flex-col gap-6 lg:mt-4">
      {/* Result Card */}
      <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-surface p-6 text-center shadow-xs">
        {isEligible ? (
          <>
            <Mascot name="shield" height={100} className="mb-2" />
            <div className="mb-2">
              <TopUpStatusChip
                chip={{
                  label: "Đang yêu cầu hoàn tiền",
                  icon: "refund",
                  tone: "teal",
                }}
              />
            </div>
            <h2 className="text-[22px] font-extrabold text-ink">
              Đã gửi yêu cầu hoàn tiền
            </h2>
            <p className="mt-1 text-body-sm text-ink-muted">
              <span className="font-bold text-ink">
                {formatPoints(request.points)} Điểm
              </span>{" "}
              đang được giữ chờ hoàn tiền.
            </p>
          </>
        ) : (
          <>
            <Mascot name="confused" height={100} className="mb-2" />
            <h2 className="text-[22px] font-extrabold text-ink">
              Đã ghi nhận yêu cầu
            </h2>
            <p className="mt-2 max-w-md text-caption text-ink-muted leading-relaxed">
              {ineligibleCopy(request.ineligibleReason ?? "SPENT_SINCE_TOP_UP")}
            </p>
          </>
        )}

        {/* Action Buttons */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="primary"
            size="base"
            radius="field"
            onClick={onViewTransaction}
          >
            Xem giao dịch
          </Button>
          <Link
            href="/wallet"
            className={buttonClassName({
              variant: "outline",
              size: "base",
              radius: "field",
            })}
          >
            Về ví
          </Link>
        </div>
      </div>

      {/* Info Details Table */}
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
        <h3 className="text-body font-bold text-ink">Thông tin hoàn tiền</h3>
        <dl className="mt-3 divide-y divide-line text-caption">
          <div className="flex justify-between py-2.5">
            <dt className="text-ink-muted">Mã giao dịch</dt>
            <dd className="font-bold text-ink">#{orderCode}</dd>
          </div>
          {isEligible && (
            <div className="flex justify-between py-2.5">
              <dt className="text-ink-muted">Số tiền hoàn</dt>
              <dd className="font-extrabold text-ink">
                {formatVnd(request.amountVnd)}
              </dd>
            </div>
          )}
          <div className="flex justify-between py-2.5">
            <dt className="text-ink-muted">Điểm đang giữ</dt>
            <dd className="font-bold text-ink">
              {isEligible
                ? `${formatPoints(request.points)} Điểm`
                : "0 Điểm (không giữ)"}
            </dd>
          </div>
          {isEligible && (
            <div className="flex justify-between py-2.5">
              <dt className="text-ink-muted">Hoàn về tài khoản đã thanh toán</dt>
              <dd className="text-right font-medium text-ink">
                {destInfo.verified
                  ? `${destInfo.bank} · ${destInfo.accountNumber}`
                  : "Admin xác minh qua email"}
              </dd>
            </div>
          )}
          <div className="flex justify-between py-2.5">
            <dt className="text-ink-muted">
              {isEligible ? "Dự kiến xử lý" : "Dự kiến phản hồi"}
            </dt>
            <dd className="font-medium text-ink">Trước {dueFormatted}</dd>
          </div>
        </dl>

        {/* Footnote */}
        <p className="mt-4 border-t border-line pt-3 text-[12px] text-ink-muted leading-relaxed">
          {isEligible ? (
            <>
              3 ngày làm việc.{" "}
              {availableBalance !== null ? (
                <>
                  Khả dụng còn{" "}
                  <span className="font-semibold text-ink">
                    {formatPoints(availableBalance)} Điểm
                  </span>
                  .{" "}
                </>
              ) : null}
              Nếu Admin từ chối, {formatPoints(request.points)} Điểm sẽ trả lại
              Khả dụng.
            </>
          ) : (
            "Số dư của bạn không thay đổi."
          )}
        </p>
      </div>
    </div>
  );
}
