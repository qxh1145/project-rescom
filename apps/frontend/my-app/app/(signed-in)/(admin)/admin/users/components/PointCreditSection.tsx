"use client";

import { useState } from "react";
import type { AdminPointCreditListItem } from "@rescom/schemas";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Tag";
import { TextField } from "@/components/ui/TextField";
import { Textarea } from "@/components/ui/Textarea";
import type { AdminUserView } from "@/lib/admin/users-service";
import {
  creditReasonError,
  formatDayMonthTime,
  parseCreditAmount,
  shortCodeOf,
} from "@/lib/admin/users-view";
import { formatPoints } from "@/lib/wallet/top-up";
import { usePointCredits } from "../hooks/use-point-credits";
import { PointCreditDialog } from "./PointCreditDialog";
import { ReverseCreditDialog } from "./ReverseCreditDialog";

interface PointCreditSectionProps {
  user: AdminUserView;
  onDetailReload?: () => void;
}

export function PointCreditSection({ user, onDetailReload }: PointCreditSectionProps) {
  const credits = usePointCredits(user.id, onDetailReload);

  const [rawAmount, setRawAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState<AdminPointCreditListItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const locked = user.status === "LOCKED";
  const parsed = parseCreditAmount(rawAmount);
  const validAmount = "amount" in parsed ? parsed.amount : null;

  function requestCredit() {
    setNotice(null);
    credits.clearError();

    let hasError = false;
    const parsedRes = parseCreditAmount(rawAmount);
    if ("error" in parsedRes) {
      setAmountError(parsedRes.error);
      hasError = true;
    } else {
      setAmountError(null);
    }

    const rErr = creditReasonError(reason);
    if (rErr) {
      setReasonError(rErr);
      hasError = true;
    } else {
      setReasonError(null);
    }

    if (!hasError && "amount" in parsedRes) {
      setDialogOpen(true);
    }
  }

  async function handleConfirmCredit(idempotencyKey: string) {
    if (!validAmount) return;
    const success = await credits.credit(validAmount, reason.trim(), idempotencyKey);
    if (success) {
      setRawAmount("");
      setReason("");
      setDialogOpen(false);
      setNotice(`Đã cộng ${formatPoints(validAmount)} Điểm cho ${shortCodeOf(user.id)}.`);
    }
  }

  async function handleConfirmReverse(journalId: string, reverseReason: string) {
    const success = await credits.reverse(journalId, reverseReason);
    if (success) {
      const amt = reverseTarget ? formatPoints(reverseTarget.amount) : "0";
      setReverseTarget(null);
      setNotice(`Đã hoàn tác ${amt} Điểm.`);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-label font-bold text-ink">Cộng Điểm</h3>

      <div className="flex flex-col gap-3">
        <TextField
          id="admin-point-credit-amount"
          label="Số Điểm"
          inputMode="numeric"
          endSlot={<span className="pr-3 text-caption text-ink-muted">Điểm</span>}
          value={rawAmount}
          disabled={locked || credits.busy !== null}
          error={amountError ?? undefined}
          onChange={(event) => {
            setRawAmount(event.target.value);
            if (amountError) setAmountError(null);
          }}
        />

        <Textarea
          id="admin-point-credit-reason"
          label="Lý do (10–500 ký tự)"
          rows={3}
          maxLength={500}
          value={reason}
          disabled={locked || credits.busy !== null}
          placeholder="Bồi thường sự cố khảo sát, thưởng đột xuất..."
          error={reasonError ?? undefined}
          onChange={(event) => {
            setReason(event.target.value);
            if (reasonError) setReasonError(null);
          }}
        />

        <Button
          variant="primary"
          size="md"
          disabled={locked || credits.busy !== null}
          onClick={requestCredit}
        >
          Cộng Điểm
        </Button>

        {locked ? (
          <p className="text-[12px] leading-4.5 text-ink-muted">
            Không thể cộng Điểm cho tài khoản đang bị khoá.
          </p>
        ) : null}
      </div>

      {notice ? (
        <Alert tone="info" className="mt-1" onDismiss={() => setNotice(null)} aria-live="polite">
          {notice}
        </Alert>
      ) : null}

      {credits.error && !dialogOpen && !reverseTarget ? (
        <Alert tone="danger" className="mt-1" onDismiss={credits.clearError}>
          {credits.error}
        </Alert>
      ) : null}

      <div className="mt-2 border-t border-line-subtle pt-4">
        <h4 className="text-label font-bold text-ink">Điểm đã cộng</h4>

        {credits.loading && credits.items.length === 0 ? (
          <p className="mt-2 text-caption text-ink-muted">Đang tải…</p>
        ) : credits.queryError && credits.items.length === 0 ? (
          // Never show the empty state on a failed load: it reads as "never credited".
          <div className="mt-2 flex items-center gap-3">
            <p role="alert" className="text-body-sm text-danger">
              Không tải được danh sách Điểm đã cộng.
            </p>
            <Button variant="outline" size="sm" onClick={credits.reload}>
              Thử lại
            </Button>
          </div>
        ) : credits.items.length === 0 ? (
          <p className="mt-2 text-body-sm text-ink-muted">Chưa có lần cộng Điểm nào.</p>
        ) : (
          <div className="mt-3 flex flex-col divide-y divide-line-subtle">
            {/* ponytail: max 50 items returned by API, no client-side pagination needed */}
            {credits.items.map((c) => (
              <div key={c.journalId} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm">
                    <span className="font-semibold text-ink">{formatPoints(c.amount)} Điểm</span>
                    <span className="text-ink-muted"> · {formatDayMonthTime(c.createdAt)}</span>
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-caption text-ink break-words">
                    {c.reason}
                  </p>
                </div>
                <div className="shrink-0 pt-0.5">
                  {c.reversed ? (
                    <Tag tone="neutral" size="sm">
                      Đã hoàn tác
                    </Tag>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={credits.busy !== null}
                      onClick={() => {
                        credits.clearError();
                        setReverseTarget(c);
                      }}
                    >
                      Hoàn tác
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {validAmount ? (
        <PointCreditDialog
          open={dialogOpen}
          user={user}
          amount={validAmount}
          reason={reason}
          busy={credits.busy === "credit"}
          error={dialogOpen ? credits.error : null}
          onConfirm={(key) => void handleConfirmCredit(key)}
          onClose={() => setDialogOpen(false)}
        />
      ) : null}

      <ReverseCreditDialog
        // Remount per credit so a finished reversal's reason never carries over.
        key={reverseTarget?.journalId ?? "none"}
        open={Boolean(reverseTarget)}
        credit={reverseTarget}
        busy={credits.busy === "reverse"}
        error={reverseTarget ? credits.error : null}
        onConfirm={(journalId, reverseReason) => void handleConfirmReverse(journalId, reverseReason)}
        onClose={() => setReverseTarget(null)}
      />
    </div>
  );
}
