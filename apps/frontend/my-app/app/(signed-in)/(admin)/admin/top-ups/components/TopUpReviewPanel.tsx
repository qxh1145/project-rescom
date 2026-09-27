"use client";

import type { ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { formatTransferReference, requesterName, reviewChecks } from "@/lib/admin/top-up-admin";
import type { AdminTopUp } from "@/lib/admin/top-up-admin-service";
import { formatDayMonth, formatShortDateTime } from "@/lib/format/date-time";
import { formatPoints, formatVnd } from "@/lib/wallet/top-up";
import type { ReviewAction } from "../hooks/use-top-up-review";

interface TopUpReviewPanelProps {
  item: AdminTopUp;
  checked: boolean[];
  onCheck: (index: number, value: boolean) => void;
  busy: ReviewAction | null;
  /** Approve failure copy (reject failures show in the dialog). */
  error: string | null;
  onApprove: () => void;
  onReject: () => void;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-body-sm text-ink-muted">{label}</dt>
      <dd className="text-right text-body-sm text-ink">{children}</dd>
    </div>
  );
}

/**
 * Figma 63:457 "Đối chiếu yêu cầu" (470px card): amount, transfer content and
 * receiving account to match against the bank statement, the three-point
 * checklist, then "Từ chối…" / "Duyệt & cộng N điểm". Reviewed requests show
 * the decision instead of the actions (ASSUMED, not drawn).
 */
export function TopUpReviewPanel({ item, checked, onCheck, busy, error, onApprove, onReject }: TopUpReviewPanelProps) {
  const name = requesterName(item);
  const points = formatPoints(item.amount);
  const checks = reviewChecks(item);
  const allChecked = checks.every((_, index) => checked[index]);
  const pending = item.status === "PENDING";
  const bank = item.paymentInstructions;
  const since = item.userCreatedAt ? `tài khoản từ ${formatDayMonth(item.userCreatedAt)}` : null;

  return (
    <section aria-labelledby="top-up-review-title" className="rounded-[22px] border border-line bg-surface p-6">
      <h2 id="top-up-review-title" className="text-[18px] font-extrabold text-ink">
        {name} · {points} điểm
      </h2>
      <p className="mt-1 text-caption text-ink-muted">{[item.userEmail, since].filter(Boolean).join(" · ")}</p>

      <dl className="mt-4 flex flex-col gap-2">
        <Row label="Số tiền cần nhận">
          <span className="font-extrabold">{formatVnd(item.amountVnd)}</span>
        </Row>
        <Row label="Nội dung chuyển khoản">
          <span className="font-mono font-bold">{formatTransferReference(item.transferReference)}</span>
        </Row>
        {bank ? (
          <Row label="Tài khoản nhận">
            <span className="font-bold">
              {bank.bankName} · {bank.accountNumber}
            </span>
          </Row>
        ) : null}
        {!pending && item.reviewedAt ? (
          <Row label={item.status === "APPROVED" ? "Duyệt lúc" : "Từ chối lúc"}>{formatShortDateTime(item.reviewedAt)}</Row>
        ) : null}
      </dl>

      {pending ? (
        <>
          <fieldset className="mt-4 rounded-2xl border border-line px-4 pt-2 pb-4">
            <legend className="px-1.5 text-label font-bold text-ink">Đã đối chiếu sao kê</legend>
            <div className="flex flex-col gap-2.5">
              {checks.map((label, index) => (
                <Checkbox
                  key={label}
                  id={`top-up-check-${index}`}
                  size={20}
                  label={<span className="text-body-sm">{label}</span>}
                  checked={Boolean(checked[index])}
                  onChange={(event) => onCheck(index, event.target.checked)}
                  disabled={busy !== null}
                />
              ))}
            </div>
          </fieldset>
          <p id="top-up-approve-note" className="mt-3.5 text-caption-relaxed text-ink-muted">
            Duyệt sẽ cộng {points} điểm vào Khả dụng, ghi sổ giao dịch và gửi thông báo cho người dùng. Không thể hoàn tiền
            sau khi đã cộng.
          </p>
          {error ? (
            <Alert tone="danger" className="mt-3">
              {error}
            </Alert>
          ) : null}
          <div className="mt-4 flex gap-2.5">
            <button
              type="button"
              onClick={onReject}
              disabled={busy !== null}
              className="inline-flex h-13 shrink-0 items-center justify-center rounded-control border border-danger bg-surface px-5 text-button font-bold text-danger transition-colors hover:bg-danger-soft disabled:cursor-not-allowed disabled:opacity-60"
            >
              Từ chối…
            </button>
            <Button
              size="lg"
              className="flex-1"
              onClick={onApprove}
              disabled={!allChecked || busy === "reject"}
              loading={busy === "approve"}
              loadingLabel="Đang cộng điểm…"
              aria-describedby="top-up-approve-note"
            >
              Duyệt &amp; cộng {points} điểm
            </Button>
          </div>
          {!allChecked ? (
            <p className="mt-2 text-caption text-ink-muted">Đánh dấu đủ 3 mục đối chiếu để duyệt.</p>
          ) : null}
        </>
      ) : item.status === "APPROVED" ? (
        <Alert tone="info" className="mt-4">
          Đã cộng {points} điểm vào Khả dụng của {name}.
        </Alert>
      ) : (
        <Alert tone="info" className="mt-4">
          Đã từ chối{item.rejectionReason ? `: ${item.rejectionReason}` : "."}
        </Alert>
      )}
    </section>
  );
}
