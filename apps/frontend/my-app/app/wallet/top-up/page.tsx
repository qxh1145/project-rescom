"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TopUpRequestDto, TopUpStatus } from "@rescom/schemas";
import { PortalShell } from "@/components/layout/PortalShell";
import { mockRepository } from "@/lib/mock/repository.ts";
import type { MockTopUpOptions } from "@/lib/mock/types.ts";

const STATUS_LABELS: Record<TopUpStatus, { label: string; className: string }> = {
  PENDING: {
    label: "Chờ thanh toán",
    className:
      "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  },
  APPROVED: {
    label: "Đã duyệt",
    className:
      "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
  },
  REJECTED: {
    label: "Bị từ chối",
    className:
      "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800",
  },
};

function formatVnd(value: number): string {
  return `${value.toLocaleString("vi-VN")} VNĐ`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: TopUpStatus }) {
  const config = STATUS_LABELS[status];
  return (
    <span
      className={`px-2 py-0.5 text-[11px] font-bold rounded-full border whitespace-nowrap ${config.className}`}
    >
      {config.label}
    </span>
  );
}

interface CopyRowProps {
  label: string;
  value: string;
  copyValue?: string;
  fieldId: string;
  copiedField: string | null;
  onCopy: (fieldId: string, value: string) => void;
  emphasize?: boolean;
}

function CopyRow({
  label,
  value,
  copyValue,
  fieldId,
  copiedField,
  onCopy,
  emphasize,
}: CopyRowProps) {
  const copied = copiedField === fieldId;
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-3 py-2.5 border-b border-slate-100 dark:border-slate-800 last:border-b-0">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="flex items-center gap-2 min-w-0">
        <span
          className={`break-all ${
            emphasize
              ? "font-mono text-sm font-black text-emerald-700 dark:text-emerald-300"
              : "text-sm font-semibold text-slate-900 dark:text-white"
          }`}
        >
          {value}
        </span>
        <button
          type="button"
          onClick={() => onCopy(fieldId, copyValue ?? value)}
          className="shrink-0 px-2 py-1 text-[11px] font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-label={`Sao chép ${label.toLowerCase()}`}
        >
          {copied ? "Đã chép ✓" : "Sao chép"}
        </button>
      </dd>
    </div>
  );
}

export default function TopUpPage() {
  const router = useRouter();
  const [options, setOptions] = useState<MockTopUpOptions | null>(null);
  const [requests, setRequests] = useState<TopUpRequestDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [amountInput, setAmountInput] = useState("100");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const user = await mockRepository.getCurrentUser();
        if (!active) return;
        if (!user) {
          router.push("/login");
          return;
        }
        const [loadedOptions, list] = await Promise.all([
          mockRepository.getTopUpOptions(),
          mockRepository.getMyTopUpRequests(),
        ]);
        if (!active) return;
        setOptions(loadedOptions);
        setRequests(list.items);
        setLoadError(null);
      } catch (err) {
        if (active) {
          setLoadError(
            err instanceof Error ? err.message : "Không thể tải dữ liệu nạp điểm.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [router, reloadKey]);

  const retry = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    setReloadKey((key) => key + 1);
  }, []);

  const amount = Number(amountInput);
  const amountIsNumber = amountInput.trim() !== "" && Number.isFinite(amount);
  const previewVnd =
    options && amountIsNumber && amount > 0 ? Math.round(amount) * options.pointVndRate : 0;

  const pendingCount = requests.filter((r) => r.status === "PENDING").length;
  const limitReached = options ? pendingCount >= options.maxPendingRequests : false;

  // Show the selected request, otherwise the most recent pending one.
  const activeRequest = useMemo(() => {
    const selected = requests.find((r) => r.id === selectedId);
    if (selected?.paymentInstructions) return selected;
    return requests.find((r) => r.status === "PENDING") ?? null;
  }, [requests, selectedId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!amountIsNumber) {
      setFormError("Vui lòng nhập số điểm muốn nạp.");
      return;
    }
    setSubmitting(true);
    try {
      const created = await mockRepository.createTopUpRequest(amount);
      const list = await mockRepository.getMyTopUpRequests();
      setRequests(list.items);
      setSelectedId(created.id);
      setStatusMessage(
        `Đã tạo yêu cầu nạp ${created.amount} điểm. Vui lòng chuyển khoản theo hướng dẫn.`,
      );
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Không thể tạo yêu cầu nạp điểm.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy(fieldId: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(fieldId);
      setStatusMessage("Đã sao chép vào bộ nhớ tạm.");
      window.setTimeout(() => {
        setCopiedField((current) => (current === fieldId ? null : current));
      }, 2000);
    } catch {
      setStatusMessage("Trình duyệt không cho phép sao chép. Vui lòng chép thủ công.");
    }
  }

  return (
    <PortalShell>
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              Nạp điểm qua chuyển khoản
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xl">
              Tạo yêu cầu nạp, chuyển khoản đúng số tiền và nội dung. Quản trị viên
              đối soát rồi cộng điểm vào số dư Khả dụng của bạn.
            </p>
          </div>
          <Link
            href="/wallet"
            className="self-start sm:self-auto px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            &larr; Về ví điểm
          </Link>
        </div>

        <p className="sr-only" role="status" aria-live="polite">
          {statusMessage}
        </p>

        {loading && (
          <div className="py-24 text-center" role="status">
            <div className="w-10 h-10 border-3 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-xs font-semibold text-slate-500">Đang tải thông tin nạp điểm...</p>
          </div>
        )}

        {!loading && loadError && (
          <div
            className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            role="alert"
          >
            <span className="text-sm font-medium text-rose-700 dark:text-rose-300">
              {loadError}
            </span>
            <button
              type="button"
              onClick={retry}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors"
            >
              Thử lại
            </button>
          </div>
        )}

        {!loading && !loadError && options && (
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Request form */}
            <section
              aria-labelledby="topup-form-title"
              className="lg:col-span-2 p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs h-fit"
            >
              <h2 id="topup-form-title" className="text-sm font-bold text-slate-900 dark:text-white">
                1. Chọn số điểm muốn nạp
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                1 điểm = {formatVnd(options.pointVndRate)}. Tối thiểu {options.minPoints} điểm
                ({formatVnd(options.minPoints * options.pointVndRate)}).
              </p>

              <form onSubmit={handleSubmit} className="mt-4 space-y-4" noValidate>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Mức nạp gợi ý">
                  {options.presetAmounts.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setAmountInput(String(preset));
                        setFormError(null);
                      }}
                      aria-pressed={amount === preset}
                      className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition-colors ${
                        amount === preset
                          ? "bg-emerald-600 border-emerald-600 text-white"
                          : "border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      {preset.toLocaleString("vi-VN")} điểm
                    </button>
                  ))}
                </div>

                <div>
                  <label
                    htmlFor="topup-amount"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                  >
                    Số điểm
                  </label>
                  <input
                    id="topup-amount"
                    type="number"
                    inputMode="numeric"
                    min={options.minPoints}
                    max={options.maxPoints}
                    step={1}
                    value={amountInput}
                    onChange={(e) => {
                      setAmountInput(e.target.value);
                      setFormError(null);
                    }}
                    aria-invalid={formError ? true : undefined}
                    aria-describedby="topup-amount-hint topup-amount-error"
                    className="w-full px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                  <p id="topup-amount-hint" className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Số tiền cần chuyển:{" "}
                    <strong className="text-slate-800 dark:text-slate-200">
                      {previewVnd > 0 ? formatVnd(previewVnd) : "—"}
                    </strong>
                  </p>
                  <p
                    id="topup-amount-error"
                    className="text-[11px] font-semibold text-rose-600 dark:text-rose-400 mt-1 min-h-4"
                    role={formError ? "alert" : undefined}
                  >
                    {formError ?? ""}
                  </p>
                </div>

                {limitReached && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl p-2.5">
                    Bạn đang có {pendingCount} yêu cầu chờ thanh toán (tối đa{" "}
                    {options.maxPendingRequests}). Hãy hoàn tất hoặc chờ quản trị viên xử lý
                    trước khi tạo yêu cầu mới.
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting || limitReached}
                  className="w-full px-4 py-2.5 text-sm font-bold rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting ? "Đang tạo yêu cầu..." : "Tạo yêu cầu nạp điểm"}
                </button>
              </form>

              <ul className="mt-5 space-y-1.5 text-[11px] text-slate-500 dark:text-slate-400 list-disc pl-4">
                <li>Nạp điểm là một chiều: không hoàn tiền, không chuyển điểm giữa các tài khoản.</li>
                <li>Điểm chỉ dùng trong RESCOM và không phải là tiền.</li>
                <li>Điểm được cộng sau khi quản trị viên xác nhận giao dịch.</li>
              </ul>
            </section>

            {/* Payment instructions */}
            <section
              aria-labelledby="topup-payment-title"
              className="lg:col-span-3 p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id="topup-payment-title" className="text-sm font-bold text-slate-900 dark:text-white">
                  2. Chuyển khoản theo hướng dẫn
                </h2>
                {activeRequest && <StatusBadge status={activeRequest.status} />}
              </div>

              {activeRequest?.paymentInstructions ? (
                <>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Yêu cầu tạo lúc {formatDateTime(activeRequest.createdAt)}. Nhập{" "}
                    <strong>chính xác</strong> nội dung chuyển khoản để hệ thống đối soát.
                  </p>
                  <dl className="mt-4">
                    <CopyRow
                      label="Ngân hàng"
                      value={activeRequest.paymentInstructions.bankName}
                      fieldId="bank"
                      copiedField={copiedField}
                      onCopy={handleCopy}
                    />
                    <CopyRow
                      label="Số tài khoản"
                      value={activeRequest.paymentInstructions.accountNumber}
                      fieldId="account"
                      copiedField={copiedField}
                      onCopy={handleCopy}
                    />
                    <CopyRow
                      label="Chủ tài khoản"
                      value={activeRequest.paymentInstructions.accountName}
                      fieldId="owner"
                      copiedField={copiedField}
                      onCopy={handleCopy}
                    />
                    <CopyRow
                      label="Số tiền"
                      value={formatVnd(activeRequest.paymentInstructions.amountVnd)}
                      copyValue={String(activeRequest.paymentInstructions.amountVnd)}
                      fieldId="amount"
                      copiedField={copiedField}
                      onCopy={handleCopy}
                    />
                    <CopyRow
                      label="Nội dung chuyển khoản"
                      value={activeRequest.paymentInstructions.transferContent}
                      fieldId="content"
                      copiedField={copiedField}
                      onCopy={handleCopy}
                      emphasize
                    />
                  </dl>

                  <details className="mt-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 p-3">
                    <summary className="text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                      Mã VietQR (dành cho ứng dụng ngân hàng)
                    </summary>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                      Chuỗi VietQR chứa sẵn tài khoản, số tiền và nội dung. Ảnh QR sẽ được hiển thị
                      khi kết nối hệ thống thật; bản demo hiển thị chuỗi để sao chép.
                    </p>
                    <div className="mt-2 flex flex-col sm:flex-row gap-2">
                      <code className="flex-1 min-w-0 break-all text-[11px] font-mono p-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">
                        {activeRequest.paymentInstructions.qrPayload}
                      </code>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopy("qr", activeRequest.paymentInstructions?.qrPayload ?? "")
                        }
                        className="shrink-0 px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                      >
                        {copiedField === "qr" ? "Đã chép ✓" : "Sao chép chuỗi VietQR"}
                      </button>
                    </div>
                  </details>

                  <p className="mt-4 text-[11px] text-sky-800 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 rounded-xl p-2.5">
                    Đây là tài khoản demo — không chuyển tiền thật. Trạng thái yêu cầu sẽ là
                    “Chờ thanh toán” cho đến khi quản trị viên xác nhận.
                  </p>
                </>
              ) : (
                <div className="py-10 text-center">
                  <div className="text-3xl mb-2" aria-hidden="true">🏦</div>
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                    Chưa có yêu cầu chờ thanh toán
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-sm mx-auto">
                    Chọn số điểm và bấm “Tạo yêu cầu nạp điểm” để nhận thông tin chuyển khoản cùng
                    cú pháp riêng của bạn.
                  </p>
                </div>
              )}
            </section>

            {/* History */}
            <section
              aria-labelledby="topup-history-title"
              className="lg:col-span-5 p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs"
            >
              <h2 id="topup-history-title" className="text-sm font-bold text-slate-900 dark:text-white">
                Lịch sử yêu cầu nạp điểm
              </h2>
              {requests.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
                  Bạn chưa tạo yêu cầu nạp điểm nào.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                  {requests.map((request) => (
                    <li
                      key={request.id}
                      className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-slate-900 dark:text-white">
                            +{request.amount.toLocaleString("vi-VN")} điểm
                          </span>
                          <StatusBadge status={request.status} />
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 break-all">
                          {formatVnd(request.amountVnd)} · Mã{" "}
                          <span className="font-mono">{request.transferReference}</span> ·{" "}
                          {formatDateTime(request.createdAt)}
                        </div>
                        {request.status === "REJECTED" && request.rejectionReason && (
                          <p className="text-[11px] text-rose-700 dark:text-rose-300 mt-1">
                            Lý do từ chối: {request.rejectionReason}
                          </p>
                        )}
                      </div>
                      {request.status === "PENDING" && (
                        <button
                          type="button"
                          onClick={() => setSelectedId(request.id)}
                          aria-pressed={activeRequest?.id === request.id}
                          className="self-start sm:self-auto shrink-0 px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          {activeRequest?.id === request.id ? "Đang hiển thị" : "Xem hướng dẫn"}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </PortalShell>
  );
}
