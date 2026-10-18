"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Mascot } from "@/components/brand/Mascot";
import { CodeIssueToasts, type CodeIssueToast } from "@/components/ui/Toasts";
import { useAdminCounts } from "@/components/layout/admin/AdminShell";
import {
  approveTopUp,
  listAdminTopUps,
  rejectTopUp,
  type AdminTopUp,
} from "@/lib/admin/top-up-admin-service";
import { formatTransferReference, requesterName } from "@/lib/admin/top-up-admin";
import { formatShortDateTime } from "@/lib/format/date-time";
import { formatPoints } from "@/lib/wallet/top-up";
import { isStaleReviewError, topUpReviewErrorMessage } from "@/lib/admin/top-up-admin-messages";
import {
  itemCode,
  PAYOS_SWITCH_COPY,
  pendingRowLabel,
  switchCardVariant,
} from "@/lib/admin/payos-switch";
import type { WalletTopUpMode } from "@/lib/wallet/use-wallet-top-up-mode";
import { ManualApproveDialog } from "./ManualApproveDialog";
import { RejectTopUpDialog } from "./RejectTopUpDialog";

interface PayosSwitchCardProps {
  mode: WalletTopUpMode;
  /** Handled manual rows, or null while tab counts are unknown. */
  manualTotal: number | null;
  onChanged: () => void;
  onRetryMode?: () => void;
}

/**
 * B4 Card: PayOS switch card (Story 13.13, Figma 190:1898 / 190:2091, AC 1-3, 10).
 *
 * Renders only when PayOS is effectively off (or error).
 * Variants:
 * - pending: at least 1 manual PENDING request exists.
 * - ready: 0 manual PENDING requests exist.
 * - error: failed to load availability status.
 * - hidden: PayOS is effectively on, or loading.
 */
export function PayosSwitchCard({
  mode,
  manualTotal,
  onChanged,
  onRetryMode,
}: PayosSwitchCardProps) {
  const { refreshCounts } = useAdminCounts();
  const [items, setItems] = useState<AdminTopUp[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [nonce, setNonce] = useState(0);

  // Active dialog state
  const [approving, setApproving] = useState<AdminTopUp | null>(null);
  const [rejecting, setRejecting] = useState<AdminTopUp | null>(null);
  const [busyRowId, setBusyRowId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Toasts
  const [toasts, setToasts] = useState<CodeIssueToast[]>([]);
  const addToast = useCallback(
    (title: string, body: string, tone: CodeIssueToast["tone"]) => {
      setToasts((old) => [...old, { id: Date.now() + Math.random(), title, body, tone }]);
    },
    [],
  );
  const dismissToast = useCallback((id: number) => {
    setToasts((old) => old.filter((t) => t.id !== id));
  }, []);

  // Refetches keep the current list on screen (no unmount of open dialogs / toasts).
  const refreshList = useCallback(() => {
    setListFailed(false);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (mode !== "manual") return;
    let cancelled = false;
    const controller = new AbortController();

    listAdminTopUps({ status: "PENDING" }, controller.signal)
      .then((res) => {
        if (!cancelled) {
          setItems(res.items);
          setTotal(res.total);
          setListFailed(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          if ((err as { name?: string })?.name === "AbortError") return;
          setListFailed(true);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [mode, nonce]);

  const variant = switchCardVariant({
    mode,
    pendingTotal: total,
  });

  if (variant === "hidden") return null;

  // Render error loading availability, or the pending list (card must not vanish while PayOS is off)
  const failure =
    variant === "error"
      ? { message: PAYOS_SWITCH_COPY.loadError, retry: onRetryMode }
      : listFailed && mode === "manual"
        ? { message: PAYOS_SWITCH_COPY.listLoadError, retry: refreshList }
        : null;
  if (failure) {
    return (
      <section
        aria-labelledby="payos-switch-card-title"
        className="rounded-[22px] border border-danger/30 bg-surface p-6 shadow-xs"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-danger">
            <Icon name="alert-circle" size={20} />
            <span className="font-semibold">{failure.message}</span>
          </div>
          {failure.retry && (
            <Button variant="secondary" size="base" radius="field" onClick={failure.retry}>
              {PAYOS_SWITCH_COPY.retry}
            </Button>
          )}
        </div>
      </section>
    );
  }

  // Initial load of availability or pending list
  if (variant === "loading") {
    return null;
  }

  const handleApprove = async () => {
    if (!approving || busyRowId) return;
    setBusyRowId(approving.id);
    setActionError(null);
    try {
      const res = await approveTopUp(approving.id);
      const name = requesterName(res.topUp);
      addToast(
        "Đã duyệt nạp điểm",
        `Đã cộng ${formatPoints(res.topUp.amount)} điểm cho ${name}.`,
        "success",
      );
      setApproving(null);
      refreshList();
      refreshCounts();
      onChanged();
    } catch (err) {
      const msg = topUpReviewErrorMessage(err, "approve");
      setActionError(msg);
      addToast("Không thể duyệt", msg, "error");
      if (isStaleReviewError(err)) {
        refreshList();
        refreshCounts();
        onChanged();
      }
    } finally {
      setBusyRowId(null);
    }
  };

  const handleReject = async (reason: string): Promise<boolean> => {
    if (!rejecting || busyRowId) return false;
    setBusyRowId(rejecting.id);
    setActionError(null);
    try {
      const res = await rejectTopUp(rejecting.id, reason);
      const name = requesterName(res.topUp);
      addToast(
        "Đã từ chối nạp điểm",
        `Đã từ chối yêu cầu ${formatPoints(res.topUp.amount)} điểm của ${name}.`,
        "info",
      );
      setRejecting(null);
      refreshList();
      refreshCounts();
      onChanged();
      return true;
    } catch (err) {
      const msg = topUpReviewErrorMessage(err, "reject");
      setActionError(msg);
      addToast("Không thể từ chối", msg, "error");
      if (isStaleReviewError(err)) {
        refreshList();
        refreshCounts();
        onChanged();
      }
      return false;
    } finally {
      setBusyRowId(null);
    }
  };

  return (
    <>
      <section
        aria-labelledby="payos-switch-card-title"
        className="rounded-[22px] border border-line bg-surface p-6 shadow-xs"
      >
        {/* Card Header: Title + Description on left, Read-only Chip on right */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <h2 id="payos-switch-card-title" className="text-lead font-extrabold text-ink">
              {PAYOS_SWITCH_COPY.cardTitle}
            </h2>
            <p className="mt-1 text-body-sm text-ink-muted leading-relaxed">
              {PAYOS_SWITCH_COPY.cardDescription}
            </p>
          </div>

          <div className="shrink-0 flex flex-col items-start sm:items-end gap-1">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-subtle px-3 py-1 text-caption font-bold text-ink"
              aria-label={PAYOS_SWITCH_COPY.chipOff}
            >
              <Icon name="lock" size={14} className="text-ink-muted" />
              {PAYOS_SWITCH_COPY.chipOff}
            </span>
            <span className="text-[11px] text-ink-muted">
              {PAYOS_SWITCH_COPY.chipCaption}
            </span>
          </div>
        </div>

        {/* VARIANT 1: PENDING (190:1898) */}
        {variant === "pending" && (
          <div className="mt-6 flex flex-col gap-4">
            {/* Amber Alert Banner */}
            <div className="flex items-start gap-3 rounded-xl border border-tone-amber-accent bg-tone-amber-bg p-4 text-ink">
              <Icon name="alert-circle" size={20} className="mt-0.5 shrink-0 text-tone-amber-ink" />
              <div className="flex flex-col gap-1 text-body-sm">
                <strong className="font-bold">
                  {PAYOS_SWITCH_COPY.pendingBannerTitle(total ?? items.length)}
                </strong>
                <p className="text-ink-muted leading-relaxed">
                  {PAYOS_SWITCH_COPY.pendingBannerDesc}
                </p>
              </div>
            </div>

            {/* Desktop Table (1440) */}
            <div className="hidden md:block overflow-x-auto rounded-xl border border-line">
              <table className="w-full table-fixed border-collapse text-left text-body-sm">
                <colgroup>
                  <col className="w-[15%]" />
                  <col className="w-[25%]" />
                  <col className="w-[20%]" />
                  <col className="w-[18%]" />
                  <col className="w-[12%]" />
                  <col className="w-[10%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-line bg-surface-subtle text-caption font-semibold text-ink-muted">
                    <th scope="col" className="px-4 py-3">Mã yêu cầu</th>
                    <th scope="col" className="px-4 py-3">Người dùng</th>
                    <th scope="col" className="px-4 py-3">Số tiền → Điểm</th>
                    <th scope="col" className="px-4 py-3">Nội dung CK</th>
                    <th scope="col" className="px-4 py-3">Gửi lúc</th>
                    <th scope="col" className="px-4 py-3 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line text-ink">
                  {items.map((item) => {
                    const rowBusy = busyRowId === item.id;
                    return (
                      <tr key={item.id} className="hover:bg-surface-muted/50">
                        <td className="px-4 py-3 font-mono font-bold text-caption">
                          {itemCode(item)}
                        </td>
                        <td className="px-4 py-3 truncate">
                          <strong className="block font-semibold truncate">{requesterName(item)}</strong>
                          <span className="text-xs text-ink-muted truncate block">{item.userEmail}</span>
                        </td>
                        <td className="px-4 py-3 font-bold text-caption text-primary">
                          {pendingRowLabel(item)}
                        </td>
                        <td className="px-4 py-3 font-mono text-caption truncate" title={item.transferReference}>
                          {formatTransferReference(item.transferReference)}
                        </td>
                        <td className="px-4 py-3 text-caption text-ink-muted">
                          {formatShortDateTime(item.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={rowBusy || busyRowId !== null}
                              onClick={() => {
                                setActionError(null);
                                setRejecting(item);
                              }}
                            >
                              {PAYOS_SWITCH_COPY.buttonReject}
                            </Button>
                            <Button
                              type="button"
                              variant="primary"
                              size="sm"
                              disabled={rowBusy || busyRowId !== null}
                              onClick={() => {
                                setActionError(null);
                                setApproving(item);
                              }}
                            >
                              {PAYOS_SWITCH_COPY.buttonApprove}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile List (390 cards) */}
            <div className="flex flex-col gap-3 md:hidden">
              {items.map((item) => {
                const rowBusy = busyRowId === item.id;
                return (
                  <article
                    key={item.id}
                    className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4 text-body-sm shadow-2xs"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-ink-muted">
                        #{itemCode(item)}
                      </span>
                      <span className="font-bold text-primary">
                        {pendingRowLabel(item)}
                      </span>
                    </div>

                    <div className="flex flex-col">
                      <strong className="font-semibold text-ink">{requesterName(item)}</strong>
                      <span className="text-xs text-ink-muted break-all">{item.userEmail}</span>
                    </div>

                    <div className="flex items-center justify-between text-xs text-ink-muted pt-1 border-t border-line/60">
                      <span className="font-mono">
                        {formatTransferReference(item.transferReference)}
                      </span>
                      <span>{formatShortDateTime(item.createdAt)}</span>
                    </div>

                    <div className="mt-2 flex gap-2 pt-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        fullWidth
                        disabled={rowBusy || busyRowId !== null}
                        onClick={() => {
                          setActionError(null);
                          setRejecting(item);
                        }}
                      >
                        {PAYOS_SWITCH_COPY.buttonReject}
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        fullWidth
                        disabled={rowBusy || busyRowId !== null}
                        onClick={() => {
                          setActionError(null);
                          setApproving(item);
                        }}
                      >
                        {PAYOS_SWITCH_COPY.buttonApprove}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>

            {/* Pagination Note when total > items.length */}
            {total !== null && total > items.length && (
              <p className="text-caption text-ink-muted">
                {PAYOS_SWITCH_COPY.pendingShowingPartial(items.length, total)}
              </p>
            )}

            {/* Footer Notice */}
            <p className="text-caption text-ink-muted leading-relaxed">
              {PAYOS_SWITCH_COPY.pendingFooter}
            </p>
          </div>
        )}

        {/* VARIANT 2: READY (190:2091) */}
        {variant === "ready" && (
          <div className="mt-6 flex flex-col items-center justify-center rounded-2xl border border-tone-green-accent bg-tone-green-bg p-8 text-center sm:p-10">
            <Mascot name="cheer" height={96} className="mb-4" />
            <h3 className="text-title-sm font-extrabold text-ink">
              {PAYOS_SWITCH_COPY.readyTitle}
            </h3>
            {manualTotal !== null && (
              <p className="mt-1 text-body-sm text-ink-muted">
                {PAYOS_SWITCH_COPY.readyHandledSubtitle(manualTotal)}
              </p>
            )}

            <ul className="mt-6 flex flex-col gap-2.5 text-left text-body-sm font-semibold text-ink">
              <li className="flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded-full bg-primary text-white">
                  <Icon name="check" size={13} />
                </span>
                <span>{PAYOS_SWITCH_COPY.readyChecklistPending}</span>
              </li>
              <li className="flex items-center gap-2 text-ink-strong">
                <span className="flex size-5 items-center justify-center rounded-full bg-surface-subtle text-ink-muted">
                  <Icon name="info" size={13} />
                </span>
                <span>{PAYOS_SWITCH_COPY.readyChecklistRestart}</span>
              </li>
            </ul>
          </div>
        )}
      </section>

      {/* Approve Dialog */}
      {approving && (
        <ManualApproveDialog
          item={approving}
          busy={busyRowId === approving.id}
          error={actionError}
          onClose={() => {
            if (busyRowId) return;
            setApproving(null);
            setActionError(null);
          }}
          onConfirm={handleApprove}
        >
          <CodeIssueToasts items={toasts} dismiss={dismissToast} />
        </ManualApproveDialog>
      )}

      {/* Reject Dialog */}
      {rejecting && (
        <RejectTopUpDialog
          item={rejecting}
          busy={busyRowId === rejecting.id}
          error={actionError}
          onClose={() => {
            if (busyRowId) return;
            setRejecting(null);
            setActionError(null);
          }}
          onConfirm={handleReject}
        />
      )}

      {/* Toasts when dialogs are not open (the reject dialog shows its error inline) */}
      {!approving && !rejecting && <CodeIssueToasts items={toasts} dismiss={dismissToast} />}
    </>
  );
}
