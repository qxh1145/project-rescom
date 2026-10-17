"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  AdminTopUpRefundListItem,
  AdminTopUpRefundDetail,
} from "@rescom/schemas";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { Mascot } from "@/components/brand/Mascot";
import { CodeIssueToasts, type CodeIssueToast } from "@/components/ui/Toasts";
import { formatShortDateTime } from "@/lib/format/date-time";
import { formatVnd } from "@/lib/wallet/top-up";
import { isApiError } from "@/lib/api/api-error";
import {
  listAdminTopUpRefunds,
  getAdminTopUpRefund,
  resolveAdminTopUpRefund,
  recordAdminTopUpRefundBankTransfer,
  exportPayosTopUps,
} from "@/lib/admin/payos-top-up-admin-service";
import { payosAdminErrorMessage } from "@/lib/admin/payos-top-up-admin-messages";
import {
  refundSla,
  verdictChip,
  verdictShortReason,
} from "@/lib/admin/payos-top-up-refund";
import { RefundDrawer } from "./RefundDrawer";
import { MarkRefundedDialog } from "./MarkRefundedDialog";
import { RejectRefundDialog } from "./RejectRefundDialog";
import { BankTransferDialog } from "./BankTransferDialog";

const PAGE_SIZE = 10;

export function RefundRequestsPanel({ onChanged }: { onChanged: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [statusFilter, setStatusFilter] = useState<"OPEN" | "RESOLVED" | "ALL">("OPEN");
  const [verdictFilter, setVerdictFilter] = useState<"ALL" | "ELIGIBLE" | "NOT_ELIGIBLE">("ALL");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<AdminTopUpRefundListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorAt, setErrorAt] = useState<Date | null>(null);

  const [selected, setSelected] = useState<AdminTopUpRefundDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [dialogMode, setDialogMode] = useState<"NONE" | "MARK_REFUNDED" | "REJECT" | "BANK_TRANSFER">("NONE");
  const [toasts, setToasts] = useState<CodeIssueToast[]>([]);

  const toast = useCallback(
    (title: string, body: string, tone: CodeIssueToast["tone"]) => {
      setToasts((prev) => [
        ...prev,
        { id: Date.now() + Math.random(), title, body, tone },
      ]);
    },
    [],
  );
  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Stale-guarded load list
  const listAbortRef = useRef<AbortController | null>(null);
  const loadList = useCallback(() => {
    if (listAbortRef.current) {
      listAbortRef.current.abort();
    }
    const controller = new AbortController();
    listAbortRef.current = controller;
    queueMicrotask(() => {
      if (!controller.signal.aborted) {
        setLoading(true);
        setErrorAt(null);
      }
    });

    listAdminTopUpRefunds(
      {
        status: statusFilter,
        verdict: verdictFilter,
        q: debouncedSearch.trim() || undefined,
        page,
      },
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setItems(data.items);
          setTotal(data.total);
          const totalPages = Math.ceil(data.total / PAGE_SIZE) || 1;
          if (page > totalPages) {
            setPage(totalPages);
          }
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted && err?.name !== "AbortError") {
          setErrorAt(new Date());
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [statusFilter, verdictFilter, debouncedSearch, page]);

  useEffect(() => {
    const cancel = loadList();
    return cancel;
  }, [loadList]);

  // Deep Link handling: ?tab=refunds&request={requestId}
  // dismissedRef holds the id the admin closed (or that failed) until the URL
  // drops it, so the effect below cannot reopen it while router.replace is pending.
  const detailRequestIdRef = useRef<string | null>(null);
  const dismissedRef = useRef<string | null>(null);
  const requestParam = searchParams.get("request");

  const openDetail = useCallback(
    async (id: string, updateUrl = true) => {
      detailRequestIdRef.current = id;
      dismissedRef.current = null;
      setLoadingDetail(true);
      try {
        const detail = await getAdminTopUpRefund(id);
        if (detailRequestIdRef.current === id) {
          setSelected(detail);
          if (updateUrl) {
            const nextQuery = new URLSearchParams(searchParams.toString());
            nextQuery.set("request", id);
            router.replace(`${pathname}?${nextQuery.toString()}`);
          }
        }
      } catch (err) {
        if (detailRequestIdRef.current === id) {
          dismissedRef.current = id;
          setSelected(null);
          if (isApiError(err) && (err.status === 404 || err.code === "TOPUP_REFUND_NOT_FOUND")) {
            toast("Không tìm thấy yêu cầu", "Không tìm thấy yêu cầu hoàn tiền này.", "error");
            const nextQuery = new URLSearchParams(searchParams.toString());
            nextQuery.delete("request");
            router.replace(`${pathname}?${nextQuery.toString()}`);
          } else {
            toast("Không thể tải yêu cầu", payosAdminErrorMessage(err), "error");
          }
        }
      } finally {
        if (detailRequestIdRef.current === id) {
          setLoadingDetail(false);
        }
      }
    },
    [pathname, router, searchParams, toast],
  );

  const closeDetail = useCallback(() => {
    dismissedRef.current = detailRequestIdRef.current ?? requestParam;
    detailRequestIdRef.current = null;
    setSelected(null);
    setDialogMode("NONE");
    const nextQuery = new URLSearchParams(searchParams.toString());
    nextQuery.delete("request");
    router.replace(`${pathname}?${nextQuery.toString()}`);
  }, [pathname, requestParam, router, searchParams]);

  useEffect(() => {
    if (!requestParam) {
      dismissedRef.current = null;
      return;
    }
    if (dismissedRef.current === requestParam || detailRequestIdRef.current === requestParam) return;
    queueMicrotask(() => {
      openDetail(requestParam, false);
    });
  }, [requestParam, openDetail]);

  // Dialog actions keep the dialog open (and the typed input) on server errors:
  // the error is rethrown so the dialog shows it in an Alert. Only a vanished or
  // already-resolved request closes the dialog (UX-DR-P25).
  async function settleActionError(err: unknown, title: string) {
    const gone = isApiError(err) && (err.status === 404 || err.code === "TOPUP_REFUND_NOT_FOUND");
    const resolved = isApiError(err) && err.code === "REFUND_ALREADY_RESOLVED";
    if (!gone && !resolved) throw err;
    toast(title, payosAdminErrorMessage(err), "error");
    setDialogMode("NONE");
    onChanged();
    loadList();
    if (gone) {
      closeDetail();
    } else if (selected?.id) {
      getAdminTopUpRefund(selected.id)
        .then((d) => setSelected(d))
        .catch(() => {});
    }
  }

  // Handlers for dialog actions
  async function handleMarkRefunded(data: {
    destinationConfirmed: boolean;
    bankTransferReference?: string;
    bankTransferredAt?: string;
  }) {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await resolveAdminTopUpRefund(selected.id, {
        decision: "REFUNDED",
        destinationConfirmed: data.destinationConfirmed,
        bankTransferReference: data.bankTransferReference,
        bankTransferredAt: data.bankTransferredAt,
      });
      toast("Đã hoàn tiền", `Yêu cầu #${selected.orderCode} đã được hoàn tất.`, "success");
      setSelected(res.request);
      setDialogMode("NONE");
      loadList();
      onChanged();
    } catch (err) {
      await settleActionError(err, "Lỗi xử lý hoàn tiền");
    } finally {
      setBusy(false);
    }
  }

  async function handleReject(data: { reason: string; manualTransferRecorded: boolean }) {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await resolveAdminTopUpRefund(selected.id, {
        decision: "REJECTED",
        reason: data.reason,
        manualTransferRecorded: data.manualTransferRecorded,
      });
      toast("Đã từ chối", `Yêu cầu #${selected.orderCode} đã bị từ chối.`, "info");
      setSelected(res.request);
      setDialogMode("NONE");
      loadList();
      onChanged();
    } catch (err) {
      await settleActionError(err, "Lỗi từ chối hoàn tiền");
    } finally {
      setBusy(false);
    }
  }

  async function handleRecordBankTransfer(data: {
    bankTransferReference?: string;
    bankTransferredAt?: string;
  }) {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await recordAdminTopUpRefundBankTransfer(selected.id, data);
      toast("Thành công", "Đã cập nhật thông tin chuyển khoản.", "success");
      setSelected(res.request);
      setDialogMode("NONE");
      loadList();
    } catch (err) {
      await settleActionError(err, "Lỗi ghi nhận chuyển khoản");
    } finally {
      setBusy(false);
    }
  }

  async function handleExportCsv() {
    if (exporting) return;
    setExporting(true);
    try {
      const now = new Date();
      // Local calendar dates ("sv-SE" prints yyyy-MM-dd); toISOString would shift by the UTC offset.
      const from = new Date(now.getFullYear(), 0, 1).toLocaleDateString("sv-SE");
      const to = now.toLocaleDateString("sv-SE");
      const { blob, fileName } = await exportPayosTopUps({ from, to });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName || `rescom-payos-topups-${from}-${to}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast("Không thể xuất CSV", payosAdminErrorMessage(err), "error");
    } finally {
      setExporting(false);
    }
  }

  const now = new Date();
  const totalPages = Math.ceil(total / PAGE_SIZE) || 1;

  return (
    <div className="space-y-4">
      {/* Controls / Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status buttons with aria-pressed */}
          <div className="inline-flex rounded-lg border border-line p-0.5 bg-surface-subtle text-xs font-medium">
            <button
              type="button"
              aria-pressed={statusFilter === "OPEN"}
              onClick={() => {
                setStatusFilter("OPEN");
                setPage(1);
              }}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                statusFilter === "OPEN"
                  ? "bg-surface font-bold text-ink shadow-sm"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              Đang mở
            </button>
            <button
              type="button"
              aria-pressed={statusFilter === "RESOLVED"}
              onClick={() => {
                setStatusFilter("RESOLVED");
                setPage(1);
              }}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                statusFilter === "RESOLVED"
                  ? "bg-surface font-bold text-ink shadow-sm"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              Đã xử lý
            </button>
            <button
              type="button"
              aria-pressed={statusFilter === "ALL"}
              onClick={() => {
                setStatusFilter("ALL");
                setPage(1);
              }}
              className={`rounded-md px-3 py-1.5 transition-colors ${
                statusFilter === "ALL"
                  ? "bg-surface font-bold text-ink shadow-sm"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              Tất cả
            </button>
          </div>

          {/* Verdict dropdown */}
          <select
            value={verdictFilter}
            onChange={(e) => {
              setVerdictFilter(e.target.value as "ALL" | "ELIGIBLE" | "NOT_ELIGIBLE");
              setPage(1);
            }}
            aria-label="Lọc điều kiện kết luận"
            className="rounded border border-line bg-surface px-2.5 py-1.5 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="ALL">Tất cả kết luận</option>
            <option value="ELIGIBLE">Hợp lệ</option>
            <option value="NOT_ELIGIBLE">Không hợp lệ</option>
          </select>

          {/* Sort indicator for open requests */}
          {statusFilter === "OPEN" && (
            <span className="hidden sm:inline-block rounded bg-surface-subtle border border-line px-2 py-1 text-xs text-ink-muted font-medium">
              Gần hạn trước
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Search */}
          <div className="w-full sm:w-64">
            <input
              type="search"
              maxLength={100}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo mã đơn hoặc email…"
              aria-label="Tìm kiếm yêu cầu hoàn tiền"
              className="w-full rounded border border-line bg-surface px-3 py-1.5 text-xs text-ink placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Export CSV (Desktop only) */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={exporting}
            onClick={handleExportCsv}
            className="hidden md:inline-flex items-center gap-1.5"
          >
            <Icon name="file-text" size={14} />
            {exporting ? "Đang xuất…" : "Xuất CSV"}
          </Button>
        </div>
      </div>

      {/* Main Content */}
      {loading ? (
        <div className="rounded-lg border border-line p-12 text-center text-sm text-ink-muted">
          Đang tải danh sách yêu cầu hoàn tiền…
        </div>
      ) : errorAt ? (
        <div className="rounded-lg border border-line p-12 text-center space-y-3">
          <p className="text-sm text-rose-600">Không thể tải dữ liệu yêu cầu hoàn tiền.</p>
          <Button variant="outline" onClick={loadList}>
            Thử lại
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-line p-12 text-center space-y-3 bg-surface">
          <Mascot name="cheer" height={100} />
          <h4 className="font-semibold text-ink">Không có yêu cầu hoàn tiền nào</h4>
          <p className="text-sm text-ink-muted max-w-sm mx-auto">
            Hiện không có yêu cầu hoàn tiền phù hợp với bộ lọc đã chọn.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop Table (Hidden on mobile) */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line bg-surface-subtle text-ink-muted font-semibold">
                <tr>
                  <th className="px-4 py-3">Người dùng</th>
                  <th className="px-4 py-3">Giao dịch</th>
                  <th className="px-4 py-3">Gửi lúc</th>
                  <th className="px-4 py-3">Kết luận</th>
                  <th className="px-4 py-3 text-right">Điểm giữ</th>
                  <th className="px-4 py-3">Hạn SLA</th>
                  <th className="px-4 py-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {items.map((row) => {
                  const chip = verdictChip(row);
                  const shortReason = verdictShortReason(row);
                  const sla = refundSla(row, now);

                  return (
                    <tr
                      key={row.id}
                      onClick={() => openDetail(row.id)}
                      className={`cursor-pointer transition-colors ${
                        row.overdue
                          ? "bg-rose-50/70 hover:bg-rose-100/60"
                          : "hover:bg-surface-subtle"
                      }`}
                    >
                      <td className="px-4 py-3.5">
                        <div className="font-bold text-ink">
                          {row.userName || row.userEmail || "—"}
                        </div>
                        <div className="text-ink-muted font-mono">{row.userEmail}</div>
                      </td>

                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5 font-mono font-bold text-ink">
                          <span>#{row.orderCode}</span>
                          {!row.destinationVerified && (
                            <span
                              title="Tài khoản chưa xác minh từ PayOS"
                              className="rounded bg-amber-100 text-amber-800 px-1 py-0.2 text-[10px] font-semibold"
                            >
                              Chưa xác minh TK
                            </span>
                          )}
                        </div>
                        <div className="text-ink-muted font-medium">
                          {formatVnd(row.amountVnd)} · {row.points} Điểm
                        </div>
                      </td>

                      <td className="px-4 py-3.5 whitespace-nowrap text-ink-muted font-mono">
                        {formatShortDateTime(row.submittedAt)}
                      </td>

                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                              chip.tone === "success"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {chip.label}
                          </span>
                        </div>
                        <div className="text-ink-muted text-[11px] mt-0.5">{shortReason}</div>
                      </td>

                      <td className="px-4 py-3.5 text-right font-semibold text-ink">
                        {row.heldPoints > 0 ? `${row.heldPoints} Điểm` : "0 Điểm"}
                      </td>

                      <td className="px-4 py-3.5">
                        <div
                          className={`font-bold ${
                            sla.overdue ? "text-rose-700" : "text-ink"
                          }`}
                        >
                          {sla.line}
                        </div>
                        <div className="text-ink-muted text-[11px]">{sla.dueLabel}</div>
                      </td>

                      <td className="px-4 py-3.5 text-right">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetail(row.id);
                          }}
                        >
                          Chi tiết
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards List (< md) */}
          <div className="md:hidden space-y-3">
            <p className="text-[11px] text-ink-muted italic bg-surface-subtle border border-line rounded p-2 text-center">
              Mobile chỉ để xem và xử lý nhanh. Bảng đầy đủ, bộ lọc và xuất CSV dùng trên desktop.
            </p>
            {items.map((row) => {
              const sla = refundSla(row, now);
              const chip = verdictChip(row);
              const shortReason = verdictShortReason(row);

              return (
                <div
                  key={row.id}
                  onClick={() => openDetail(row.id)}
                  className={`rounded-lg border border-line p-3.5 space-y-2 cursor-pointer transition-colors ${
                    row.overdue ? "bg-rose-50/70 border-rose-200" : "bg-surface"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-bold text-ink text-sm">
                        {row.userName || row.userEmail || "Người dùng"}
                      </div>
                      <div className="text-xs text-ink-muted font-mono">
                        #{row.orderCode} · {formatVnd(row.amountVnd)}
                      </div>
                    </div>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-bold ${
                        sla.overdue ? "bg-rose-100 text-rose-800" : "bg-surface-subtle text-ink"
                      }`}
                    >
                      {sla.line}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-1 border-t border-line-subtle">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`inline-block size-2 rounded-full ${
                          chip.tone === "success" ? "bg-emerald-600" : "bg-amber-600"
                        }`}
                      />
                      <span className="text-ink-muted">
                        giữ {row.heldPoints} Điểm · {shortReason}
                      </span>
                    </div>
                    <span className="text-primary font-bold">Xem →</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer & Pagination */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs text-ink-muted">
            <p>
              Hiển thị {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} trong {total}{" "}
              yêu cầu {statusFilter === "OPEN" ? "đang mở" : "hoàn tiền"} · SLA 3 ngày làm việc, quá
              hạn nền đỏ
            </p>

            {total > PAGE_SIZE && (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Trước
                </Button>
                <span className="px-2 font-medium">
                  Trang {page} / {totalPages}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Sau
                </Button>
              </div>
            )}
          </div>
        </>
      )}

      {/* Slide-over Drawer */}
      <RefundDrawer
        item={selected}
        busy={busy || loadingDetail}
        onClose={closeDetail}
        onOpenMarkRefunded={() => setDialogMode("MARK_REFUNDED")}
        onOpenReject={() => setDialogMode("REJECT")}
        onOpenBankTransfer={() => setDialogMode("BANK_TRANSFER")}
        onToast={toast}
      >
        <CodeIssueToasts items={toasts} dismiss={dismiss} />
      </RefundDrawer>

      {/* Dialogs */}
      {dialogMode === "MARK_REFUNDED" && (
        <MarkRefundedDialog
          key={`mark-${selected?.id}`}
          item={selected}
          busy={busy}
          open={dialogMode === "MARK_REFUNDED"}
          onClose={() => setDialogMode("NONE")}
          onConfirm={handleMarkRefunded}
        />
      )}

      {dialogMode === "REJECT" && (
        <RejectRefundDialog
          key={`reject-${selected?.id}`}
          item={selected}
          busy={busy}
          open={dialogMode === "REJECT"}
          onClose={() => setDialogMode("NONE")}
          onConfirm={handleReject}
        />
      )}

      {dialogMode === "BANK_TRANSFER" && (
        <BankTransferDialog
          key={`transfer-${selected?.id}`}
          item={selected}
          busy={busy}
          open={dialogMode === "BANK_TRANSFER"}
          onClose={() => setDialogMode("NONE")}
          onConfirm={handleRecordBankTransfer}
        />
      )}

      {/* Toasts when drawer is closed */}
      {!selected && <CodeIssueToasts items={toasts} dismiss={dismiss} />}
    </div>
  );
}
