"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import type { TopUpRefundReason, UserTopUpRefundDestinationView } from "@rescom/schemas";
import { BankLogo } from "@/components/brand/BankLogo";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Radio } from "@/components/ui/Radio";
import { Textarea } from "@/components/ui/Textarea";
import { radioGroupKeyTarget } from "@/components/ui/radio-group-keys";
import { formatPoints } from "@/lib/wallet/top-up";
import {
  REFUND_REASON_OPTIONS,
  refundDestinationLabel,
  validateRefundForm,
} from "@/lib/wallet/top-up-refund";

interface RefundFormProps {
  points: number;
  destination: UserTopUpRefundDestinationView | null | undefined;
  sessionEmail?: string | null;
  serverFieldErrors?: { reason?: string; note?: string };
  /** Clears the server error for a field once the user edits it. */
  onFieldEdit?: (field: "reason" | "note") => void;
  onCancel: () => void;
  onSubmit: (reason: TopUpRefundReason, note: string) => void;
}

/**
 * Refund form component (Story 13.11, AC 2; Figma 184:2443, 196:3588, validation 184:2755).
 */
export function RefundForm({
  points,
  destination,
  sessionEmail,
  serverFieldErrors,
  onFieldEdit,
  onCancel,
  onSubmit,
}: RefundFormProps) {
  const [reason, setReason] = useState<TopUpRefundReason | null>(null);
  const [note, setNote] = useState("");
  const [localErrors, setLocalErrors] = useState<{ reason?: string; note?: string }>({});

  const reasonFieldRef = useRef<HTMLDivElement>(null);
  const noteFieldRef = useRef<HTMLTextAreaElement>(null);

  const errors = {
    ...localErrors,
    ...serverFieldErrors,
  };

  const destInfo = refundDestinationLabel(destination);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = reason
      ? REFUND_REASON_OPTIONS.findIndex((opt) => opt.value === reason)
      : -1;
    const targetIndex = radioGroupKeyTarget(
      e.key,
      currentIndex,
      REFUND_REASON_OPTIONS.length,
    );
    if (targetIndex !== null) {
      e.preventDefault();
      const targetOption = REFUND_REASON_OPTIONS[targetIndex];
      if (targetOption) {
        setReason(targetOption.value);
        setLocalErrors((prev) => ({ ...prev, reason: undefined }));
        onFieldEdit?.("reason");
        const radioInput = document.getElementById(
          `refund-reason-${targetOption.value}`,
        );
        radioInput?.focus();
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = validateRefundForm({ reason, note });

    if (!result.ok) {
      setLocalErrors(result.errors);
      if (result.errors.reason) {
        const firstRadio = document.getElementById(
          `refund-reason-${REFUND_REASON_OPTIONS[0].value}`,
        );
        firstRadio?.focus();
      } else if (result.errors.note) {
        noteFieldRef.current?.focus();
      }
      return;
    }

    setLocalErrors({});
    onSubmit(result.value.reason, result.value.note);
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 text-left">
      <div>
        <h3 className="text-body font-bold text-ink">Yêu cầu hoàn tiền</h3>
        <p className="mt-1 text-caption text-ink-muted">
          Điền lý do và ghi chú để gửi yêu cầu hoàn tiền cho Admin.
        </p>
      </div>

      {/* Destination Account Section */}
      <div className="rounded-xl border border-line bg-slate-50 p-4">
        {destInfo.verified ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-caption font-bold text-ink">
              Tài khoản nhận hoàn tiền
            </span>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white border border-line shadow-xs">
                <BankLogo bankId={destination?.bankId} bankName={destInfo.bank} size={16} className="text-ink-muted" />
              </span>
              <span className="text-body-sm font-bold text-ink">
                {destInfo.bank} · {destInfo.accountNumber}
              </span>
            </div>
            {destInfo.holder && (
              <span className="text-caption text-ink-muted">
                Chủ tài khoản: <span className="font-medium text-ink">{destInfo.holder}</span>
              </span>
            )}
            <p className="mt-1 text-[12px] text-ink-muted">
              Tiền được hoàn về đúng tài khoản đã thanh toán. Không thể đổi tài khoản nhận.
            </p>
            {sessionEmail && (
              <p className="mt-1 text-[12px] text-ink-muted border-t border-line/50 pt-1.5">
                Email nhận thông báo: <span className="font-medium text-ink">{sessionEmail}</span>
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-tone-amber-accent bg-tone-amber-bg p-3 text-caption text-tone-amber-fg leading-relaxed">
            Chưa lấy được thông tin tài khoản đã thanh toán. Admin sẽ liên hệ qua email{" "}
            <span className="font-bold">{sessionEmail ?? "của bạn"}</span> để xác minh trước khi hoàn tiền.
          </div>
        )}
      </div>

      {/* Reason Radio Group */}
      <div
        ref={reasonFieldRef}
        role="radiogroup"
        aria-labelledby="refund-reason-label"
        aria-describedby={errors.reason ? "refund-reason-error" : undefined}
        onKeyDown={handleKeyDown}
        className="flex flex-col gap-2"
      >
        <span id="refund-reason-label" className="text-caption font-bold text-ink">
          Lý do hoàn tiền <span className="text-danger">*</span>
        </span>

        {errors.reason && (
          <p
            id="refund-reason-error"
            role="alert"
            className="text-caption text-danger"
          >
            {errors.reason}
          </p>
        )}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {REFUND_REASON_OPTIONS.map((opt) => (
            <Radio
              key={opt.value}
              id={`refund-reason-${opt.value}`}
              name="refundReason"
              value={opt.value}
              checked={reason === opt.value}
              variant="card"
              label={opt.label}
              onChange={() => {
                setReason(opt.value);
                setLocalErrors((prev) => ({ ...prev, reason: undefined }));
                onFieldEdit?.("reason");
              }}
            />
          ))}
        </div>
      </div>

      {/* Note Textarea */}
      <div>
        <Textarea
          ref={noteFieldRef}
          id="refund-note"
          label="Ghi chú cho Admin"
          hint="Bắt buộc với mọi lý do · tối đa 300 ký tự."
          maxLength={300}
          value={note}
          error={errors.note}
          onChange={(e) => {
            setNote(e.target.value);
            setLocalErrors((prev) => ({ ...prev, note: undefined }));
            onFieldEdit?.("note");
          }}
          placeholder="Mô tả chi tiết lý do bạn muốn hoàn tiền..."
          rows={3}
        />
        {errors.note && (
          <span className="sr-only" role="alert">
            {errors.note}
          </span>
        )}
      </div>

      {/* Info Callout */}
      <div className="flex items-start gap-2.5 rounded-xl border border-line bg-slate-50 p-3.5 text-caption text-ink-muted">
        <Icon name="info" size={16} className="mt-0.5 shrink-0 text-primary" />
        <p className="leading-relaxed">
          Nếu hợp lệ, <span className="font-bold text-ink">{formatPoints(points)} Điểm</span> sẽ bị giữ và không thể sử dụng cho tới khi Admin xử lý (tối đa 3 ngày làm việc). Chỉ hợp lệ nếu bạn chưa tiêu Điểm nào kể từ lúc nạp.
        </p>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          size="base"
          radius="field"
          onClick={onCancel}
        >
          Huỷ
        </Button>
        <Button type="submit" variant="primary" size="base" radius="field">
          Gửi yêu cầu
        </Button>
      </div>
    </form>
  );
}
