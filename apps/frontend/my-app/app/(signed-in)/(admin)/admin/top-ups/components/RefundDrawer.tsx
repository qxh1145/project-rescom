"use client";

import { useState, type ReactNode } from "react";
import type { AdminTopUpRefundDetail } from "@rescom/schemas";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { BankLogo } from "@/components/brand/BankLogo";
import { Icon } from "@/components/ui/Icon";
import { IconButton } from "@/components/ui/IconButton";
import { TopUpStatusChip } from "@/components/wallet/TopUpStatusChip";
import type { TopUpChipInfo } from "@/lib/wallet/top-up-history";
import { formatShortDateTime } from "@/lib/format/date-time";
import { formatVnd } from "@/lib/wallet/top-up";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  refundStatusBadge,
  refundReasonLabel,
  refundSla,
  refundTransferContent,
  verdictExplanation,
  auditTrail,
} from "@/lib/admin/payos-top-up-refund";

const STATUS_CHIP_STYLE: Record<
  ReturnType<typeof refundStatusBadge>["variant"],
  Pick<TopUpChipInfo, "icon" | "tone">
> = {
  warning: { icon: "hourglass", tone: "amber" },
  success: { icon: "check", tone: "green" },
  danger: { icon: "x-circle", tone: "danger" },
  neutral: { icon: "x", tone: "grey" },
};

export function RefundDrawer({
  item,
  busy,
  onClose,
  onOpenMarkRefunded,
  onOpenReject,
  onOpenBankTransfer,
  onToast,
  children,
}: {
  item: AdminTopUpRefundDetail | null;
  busy: boolean;
  onClose: () => void;
  onOpenMarkRefunded: () => void;
  onOpenReject: () => void;
  onOpenBankTransfer: () => void;
  onToast?: (title: string, body: string, tone: "success" | "error" | "info") => void;
  children?: ReactNode;
}) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!item) return null;

  const now = new Date();
  const sla = refundSla(item, now);
  const statusBadge = refundStatusBadge(item.status);
  const trails = auditTrail(item);
  const transferContent = refundTransferContent(item.orderCode);
  const isRequested = item.status === "REQUESTED";
  const isRefunded = item.status === "REFUNDED";
  const canMarkRefunded = isRequested && item.heldPoints > 0 && item.eligibility === "ELIGIBLE";
  const verdictHeadline =
    item.status === "REQUESTED"
      ? `Hợp lệ · đang giữ ${item.heldPoints} Điểm`
      : item.status === "REFUNDED"
        ? `Hợp lệ · đã trừ ${item.points} Điểm`
        : item.status === "REJECTED" && item.holdJournalId
          ? `Hợp lệ · ${item.points} Điểm đã trả về Khả dụng`
          : "Hợp lệ";
  const showAddBankTransfer = isRefunded && !item.bankTransferReference && !item.bankTransferredAt;

  async function handleCopy(key: string, text: string) {
    const success = await copyTextToClipboard(text);
    if (success) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
      onToast?.("Đã sao chép", text, "success");
    } else {
      onToast?.("Không thể sao chép", "Vui lòng chọn và sao chép thủ công.", "error");
    }
  }

  return (
    <Dialog
      key={item.id}
      open
      onClose={onClose}
      labelledBy="refund-drawer-title"
      dismissible={!busy}
      width={560}
      className="ml-auto mr-0 h-dvh max-h-dvh w-full max-w-[560px] rounded-none p-5 max-sm:w-full sm:p-6 overflow-y-auto flex flex-col"
    >
      <div className="flex-1">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-line pb-4">
          <div>
            <h2 id="refund-drawer-title" className="text-lg font-bold text-ink">
              Yêu cầu hoàn tiền #{item.orderCode}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <TopUpStatusChip chip={{ label: statusBadge.label, ...STATUS_CHIP_STYLE[statusBadge.variant] }} />
              {isRequested && (
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    sla.overdue
                      ? "bg-rose-100 text-rose-800"
                      : "bg-surface-subtle text-ink-muted"
                  }`}
                >
                  {sla.line}
                </span>
              )}
            </div>
            <p className="mt-2 text-xs text-ink-muted">
              {item.userName || item.userEmail || "Người dùng"} · {item.userEmail || "—"} · gửi{" "}
              {formatShortDateTime(item.submittedAt)}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Đóng"
            className="rounded p-1 text-ink-muted hover:bg-surface-subtle hover:text-ink transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Resolved Outcome Banner (UX-DR-P12) */}
        {!isRequested && (
          <div className="mt-4 rounded-lg border border-line bg-surface-subtle p-3.5 text-xs text-ink space-y-1">
            <span className="font-bold text-ink uppercase tracking-wider block text-[11px]">
              Kết quả xử lý
            </span>
            {item.status === "REFUNDED" && (
              <p>
                Đã đánh dấu hoàn tiền lúc {formatShortDateTime(item.resolvedAt)} · {item.points} Điểm
                đã trừ
                {item.bankTransferReference ? ` · Mã CK: ${item.bankTransferReference}` : ""}
                {item.bankTransferredAt
                  ? ` · chuyển lúc ${formatShortDateTime(item.bankTransferredAt)}`
                  : ""}
              </p>
            )}
            {item.status === "REJECTED" && (
              <p>
                Đã từ chối lúc {formatShortDateTime(item.resolvedAt)}: “{item.rejectionReason}”
                {item.manualTransferRecorded ? " · Đã chuyển trả tiền thủ công" : ""}
              </p>
            )}
            {item.status === "WITHDRAWN" && (
              <p>User đã rút yêu cầu lúc {formatShortDateTime(item.withdrawnAt)}</p>
            )}
          </div>
        )}

        {/* Verdict Card */}
        <div className="mt-4">
          {item.eligibility === "ELIGIBLE" ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-3.5 text-xs text-emerald-900 space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-emerald-800 text-sm">
                <span className="inline-block size-2 rounded-full bg-emerald-600" />
                {verdictHeadline}
              </div>
              <p className="leading-relaxed">{verdictExplanation(item)}</p>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3.5 text-xs text-amber-900 space-y-1">
              <div className="font-bold flex items-center gap-1.5 text-amber-800 text-sm">
                <span className="inline-block size-2 rounded-full bg-amber-600" />
                Không hợp lệ · không giữ Điểm
              </div>
              <p className="leading-relaxed">{verdictExplanation(item)}</p>
            </div>
          )}
        </div>

        {/* GIAO DỊCH GỐC */}
        <div className="mt-5 rounded-lg border border-line bg-surface p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink-muted mb-2">
            Giao dịch gốc
          </h3>
          <dl className="divide-y divide-line text-xs">
            <div className="flex justify-between py-2">
              <dt className="text-ink-muted">Mã giao dịch</dt>
              <dd className="font-bold text-ink font-mono">#{item.orderCode}</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-ink-muted">Số tiền</dt>
              <dd className="font-bold text-ink">{formatVnd(item.amountVnd)}</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-ink-muted">Số Điểm</dt>
              <dd className="font-semibold text-ink">{item.points} Điểm</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-ink-muted">Thanh toán lúc</dt>
              <dd className="text-ink">{formatShortDateTime(item.paidAt)}</dd>
            </div>
            <div className="flex justify-between py-2">
              <dt className="text-ink-muted">Mã PayOS</dt>
              <dd className="font-mono text-ink">{item.providerReference ?? "—"}</dd>
            </div>
          </dl>
        </div>

        {/* TÀI KHOẢN NHẬN (TÀI KHOẢN GỐC TỪ PAYOS) */}
        <div className="mt-5 rounded-lg border border-line bg-surface p-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-ink-muted mb-1">
            Tài khoản nhận (Tài khoản gốc từ payOS)
          </h3>

          {item.destination.verified ? (
            <>
              <p className="text-caption text-ink-muted mb-3">
                Tài khoản đã thanh toán lần nạp này. Chỉ chuyển hoàn về tài khoản này.
              </p>
              <dl className="divide-y divide-line text-xs">
                <div className="flex items-center justify-between py-2">
                  <dt className="text-ink-muted">Ngân hàng</dt>
                  <div className="flex items-center gap-2">
                    <BankLogo bankId={item.destination.bankId} bankName={item.destination.bankName} size={16} />
                    <dd className="font-semibold text-ink">
                      {item.destination.bankName || item.destination.bankId || "—"}
                    </dd>
                    {(item.destination.bankName || item.destination.bankId) && (
                      <IconButton icon={copiedKey === "bank" ? "check" : "copy"} label="Sao chép" iconSize={16} className="size-8!" onClick={() => handleCopy("bank", (item.destination.bankName || item.destination.bankId)!)} />
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between py-2">
                  <dt className="text-ink-muted">Số tài khoản</dt>
                  <div className="flex items-center gap-2">
                    <dd className="font-mono text-sm font-bold text-ink">
                      {item.destination.accountNumber ?? "—"}
                    </dd>
                    {item.destination.accountNumber && (
                      <IconButton icon={copiedKey === "accountNumber" ? "check" : "copy"} label="Sao chép" iconSize={16} className="size-8!" onClick={() => handleCopy("accountNumber", item.destination.accountNumber!)} />
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between py-2">
                  <dt className="text-ink-muted">Chủ tài khoản</dt>
                  <div className="flex items-center gap-2">
                    <dd className="font-semibold text-ink">
                      {item.destination.holderName ?? "—"}
                    </dd>
                    {item.destination.holderName && (
                      <IconButton icon={copiedKey === "holderName" ? "check" : "copy"} label="Sao chép" iconSize={16} className="size-8!" onClick={() => handleCopy("holderName", item.destination.holderName!)} />
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between py-2">
                  <dt className="text-ink-muted">Số tiền chuyển</dt>
                  <div className="flex items-center gap-2">
                    <dd className="font-bold text-ink">{formatVnd(item.amountVnd)}</dd>
                    <IconButton icon={copiedKey === "amount" ? "check" : "copy"} label="Sao chép" iconSize={16} className="size-8!" onClick={() => handleCopy("amount", String(item.amountVnd))} />
                  </div>
                </div>

                <div className="flex items-center justify-between py-2">
                  <dt className="text-ink-muted">Nội dung CK</dt>
                  <div className="flex items-center gap-2">
                    <dd className="font-mono font-bold text-ink">{transferContent}</dd>
                    <IconButton icon={copiedKey === "transferContent" ? "check" : "copy"} label="Sao chép" iconSize={16} className="size-8!" onClick={() => handleCopy("transferContent", transferContent)} />
                  </div>
                </div>
              </dl>
            </>
          ) : (
            <div className="mt-2 space-y-3">
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-1.5">
                <p className="font-bold text-amber-800">
                  PayOS không trả thông tin tài khoản đã thanh toán
                </p>
                <p className="leading-relaxed">
                  Liên hệ user qua email trước khi chuyển khoản. Chỉ chuyển sau khi xác minh đúng tài
                  khoản đã dùng để thanh toán. Đối chiếu tên chủ tài khoản trên sao kê ngân hàng.
                </p>
                <div className="pt-1 flex items-center justify-between">
                  <span className="font-mono text-ink font-semibold">{item.userEmail || "—"}</span>
                  {item.userEmail && (
                    <IconButton icon={copiedKey === "userEmail" ? "check" : "copy"} label="Sao chép" iconSize={16} className="size-8!" onClick={() => handleCopy("userEmail", item.userEmail!)} />
                  )}
                </div>
              </div>

              {(item.destination.bankName || item.destination.bankId || item.destination.accountNumber) && (
                <dl className="divide-y divide-line text-xs">
                  {(item.destination.bankName || item.destination.bankId) && (
                    <div className="flex justify-between py-1.5">
                      <dt className="text-ink-muted">Ngân hàng</dt>
                      <dd className="text-ink-muted">
                        {item.destination.bankName ?? `Mã ${item.destination.bankId}`} (chưa xác minh)
                      </dd>
                    </div>
                  )}
                  {item.destination.accountNumber && (
                    <div className="flex justify-between py-1.5">
                      <dt className="text-ink-muted">Số tài khoản</dt>
                      <dd className="font-mono text-ink-muted">
                        {item.destination.accountNumber} (chưa xác minh)
                      </dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
          )}
        </div>

        {/* LÝ DO CỦA USER */}
        <div className="mt-5 rounded-lg border border-line bg-surface p-4 text-xs">
          <h3 className="font-bold uppercase tracking-wider text-ink-muted mb-2">
            Lý do của user
          </h3>
          <div className="font-semibold text-ink">{refundReasonLabel(item.reason)}</div>
          {item.note && (
            <blockquote className="mt-2 rounded bg-surface-subtle p-2.5 text-ink-muted italic border-l-2 border-line">
              “{item.note}”
            </blockquote>
          )}
        </div>

        {/* AUDIT TRAIL */}
        <div className="mt-5 rounded-lg border border-line bg-surface p-4 text-xs">
          <h3 className="font-bold uppercase tracking-wider text-ink-muted mb-3">
            Audit Trail
          </h3>
          <ol className="relative border-l border-line-subtle ml-2 space-y-3">
            {trails.map((t, idx) => (
              <li key={idx} className="ml-4">
                <div className="absolute -left-1.5 mt-1 size-3 rounded-full border border-surface bg-ink-muted" />
                <time className="text-[11px] text-ink-muted block font-mono">
                  {formatShortDateTime(t.at)}
                </time>
                <p className="text-ink mt-0.5">{t.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* Sticky Bottom Actions */}
      <div className="sticky bottom-0 -mx-5 -mb-5 sm:-mx-6 sm:-mb-6 mt-6 border-t border-line bg-surface p-4 flex flex-col gap-2 shadow-md">
        {isRequested && (
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onOpenReject}
              className="flex-1 text-rose-600 hover:bg-rose-50 border-rose-200"
            >
              <Icon name="x" size={16} className="mr-1 inline-block" />
              Từ chối
            </Button>
            <div className="flex-1">
              <Button
                type="button"
                disabled={busy || !canMarkRefunded}
                onClick={onOpenMarkRefunded}
                fullWidth
              >
                <Icon name="check" size={16} className="mr-1 inline-block" />
                Đánh dấu Đã hoàn tiền
              </Button>
              {!canMarkRefunded && (
                <p className="mt-1 text-center text-[11px] text-ink-muted">
                  Chỉ bật khi Điểm đang bị giữ
                </p>
              )}
            </div>
          </div>
        )}

        {showAddBankTransfer && (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={onOpenBankTransfer}
            fullWidth
          >
            Thêm mã chuyển khoản
          </Button>
        )}
      </div>

      {children}
    </Dialog>
  );
}
