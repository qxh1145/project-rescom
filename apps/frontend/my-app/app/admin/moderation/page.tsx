"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  MODERATION_REJECTION_REASON_MAX_LENGTH,
  MODERATION_REJECTION_REASON_MIN_LENGTH,
  parseFormDefinitionDraft,
  type ModerationQueueItemDto,
  type ModerationSurveyPreviewDto,
} from "@rescom/schemas";
import { FormRenderer } from "../../forms/components/renderer/FormRenderer";
import { formatTargetingSummary } from "../../forms/[id]/edit/TargetingAudienceSummary";
import { formStatusBadgeClass, formStatusLabel } from "../../forms/form-status";
import {
  approveSurvey,
  getModerationSurvey,
  listModerationQueue,
  rejectSurvey,
} from "./moderation-api";
import {
  clampQueueOffset,
  describeModerationError,
  describeRejectionImpact,
} from "./moderation-view";

/**
 * Admin Moderation Dashboard (Story 8.1, FR-20/FR-53).
 *
 * Live-API page like the Publisher form pages (not part of the mock
 * respondent journey). Authorization is enforced server-side: the queue and
 * the decisions require an ADMIN session and a live, ACTIVE Admin account.
 */

const PAGE_SIZE = 20;

const focusRing =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-950";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatMinutes(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `~${minutes} phút`;
}

export default function AdminModerationPage() {
  const [items, setItems] = useState<ModerationQueueItemDto[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ModerationSurveyPreviewDto | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);

  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  const [submitting, setSubmitting] = useState<"approve" | "reject" | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      setQueueLoading(true);
      try {
        const page = await listModerationQueue({ limit: PAGE_SIZE, offset });
        if (!active) return;
        if (page.items.length === 0 && offset > 0 && page.total > 0) {
          // P8: deciding the last item on a later page must fall back to the
          // previous page instead of showing "empty queue".
          setOffset(clampQueueOffset(offset, page.total, PAGE_SIZE));
          return;
        }
        setItems(page.items);
        setTotal(page.total);
        setHasMore(page.hasMore);
        setQueueError(null);
      } catch (error) {
        if (active) {
          setQueueError(describeModerationError(error, "Không thể tải hàng chờ kiểm duyệt."));
        }
      } finally {
        if (active) setQueueLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [offset, reloadKey]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    async function load(formId: string) {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const loaded = await getModerationSurvey(formId);
        if (!active) return;
        setPreview(loaded);
      } catch (error) {
        if (active) {
          setPreview(null);
          setPreviewError(describeModerationError(error, "Không thể tải bản xem trước."));
        }
      } finally {
        if (active) setPreviewLoading(false);
      }
    }
    void load(selectedId);
    return () => {
      active = false;
    };
  }, [selectedId, previewKey]);

  const parsedDefinition = useMemo(() => {
    if (!preview || preview.type !== "INTERNAL") return null;
    return parseFormDefinitionDraft(preview.schemaJson);
  }, [preview]);

  const trimmedReason = reason.trim();
  const reasonError =
    trimmedReason.length < MODERATION_REJECTION_REASON_MIN_LENGTH
      ? `Lý do cần ít nhất ${MODERATION_REJECTION_REASON_MIN_LENGTH} ký tự.`
      : trimmedReason.length > MODERATION_REJECTION_REASON_MAX_LENGTH
        ? `Lý do tối đa ${MODERATION_REJECTION_REASON_MAX_LENGTH} ký tự.`
        : null;
  const isQueued = preview?.status === "MODERATION_QUEUE" && !preview.decision;
  const hasFundingShortfall = Boolean(preview?.fundingShortfall && preview.fundingShortfall > 0);
  // Decision E8-D2: rejecting a re-submission closes the live survey for good.
  const rejectionImpact = preview && isQueued ? describeRejectionImpact(preview) : null;
  const approveBlockedReason = hasFundingShortfall
    ? "Không thể phê duyệt: khảo sát chưa được ký quỹ đủ."
    : preview?.targetingInvalid
      ? "Không thể phê duyệt: tiêu chí nhắm mục tiêu không hợp lệ."
      : null;

  function selectSurvey(formId: string) {
    setSelectedId(formId);
    setPreview(null);
    setNote("");
    setReason("");
    setReasonTouched(false);
    setDecisionError(null);
    setFeedback(null);
    setPreviewKey((key) => key + 1);
  }

  async function handleDecision(action: "approve" | "reject") {
    if (!preview || submitting) return;
    if (action === "reject") {
      setReasonTouched(true);
      if (reasonError) return;
    }
    setSubmitting(action);
    setDecisionError(null);
    try {
      const result =
        action === "approve"
          ? await approveSurvey(preview.formId, {
              formVersionId: preview.formVersionId,
              ...(note.trim() ? { note: note.trim() } : {}),
            })
          : await rejectSurvey(preview.formId, {
              formVersionId: preview.formVersionId,
              reason: trimmedReason,
            });
      setFeedback(
        result.decision.outcome === "APPROVED"
          ? `Đã phê duyệt “${preview.title}”. Khảo sát đã xuất hiện trên Marketplace.`
          : preview.isResubmission
            ? `Đã từ chối “${preview.title}”: toàn bộ khảo sát (kể cả phiên bản đã duyệt trước đó) đã đóng vĩnh viễn và ${result.decision.refundAmount} điểm ký quỹ đã được hoàn cho người đăng.`
            : `Đã từ chối “${preview.title}” và hoàn ${result.decision.refundAmount} điểm ký quỹ cho người đăng.`,
      );
      setSelectedId(null);
      setPreview(null);
      setReloadKey((key) => key + 1);
    } catch (error) {
      setDecisionError(describeModerationError(error, "Không thể lưu quyết định kiểm duyệt."));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 pb-16">
      <header className="sticky top-0 z-20 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400">Quản trị RESCOM</p>
            <h1 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">
              Kiểm duyệt khảo sát
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              disabled={queueLoading}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 ${focusRing}`}
            >
              {queueLoading ? "Đang tải…" : "Làm mới"}
            </button>
            <Link
              href="/"
              className={`px-3 py-1.5 text-sm font-medium rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 ${focusRing}`}
            >
              Trang chủ
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 space-y-4">
        {feedback && (
          <div
            role="status"
            className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-200 text-sm flex items-start justify-between gap-3"
          >
            <span>{feedback}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className={`text-xs font-semibold underline shrink-0 rounded ${focusRing}`}
            >
              Đóng
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Queue */}
          <section aria-labelledby="queue-heading" className="lg:col-span-5 space-y-3">
            <div className="flex items-baseline justify-between">
              <h2 id="queue-heading" className="text-sm font-semibold text-gray-900 dark:text-white">
                Hàng chờ kiểm duyệt
              </h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">{total} khảo sát</span>
            </div>

            {queueError ? (
              <div role="alert" className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300 space-y-2">
                <p>{queueError}</p>
                <button
                  type="button"
                  onClick={() => setReloadKey((key) => key + 1)}
                  className={`text-xs font-semibold underline rounded ${focusRing}`}
                >
                  Thử lại
                </button>
              </div>
            ) : queueLoading && items.length === 0 ? (
              <ul aria-busy="true" className="space-y-2">
                {[0, 1, 2].map((key) => (
                  <li key={key} className="h-20 rounded-xl bg-gray-200/70 dark:bg-gray-800/70 animate-pulse motion-reduce:animate-none" />
                ))}
              </ul>
            ) : items.length === 0 ? (
              <div className="p-6 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 text-center text-sm text-gray-500 dark:text-gray-400">
                Không có khảo sát nào đang chờ kiểm duyệt.
              </div>
            ) : (
              <ul className="space-y-2">
                {items.map((item) => {
                  const selected = item.formId === selectedId;
                  return (
                    <li key={item.formId}>
                      <button
                        type="button"
                        onClick={() => selectSurvey(item.formId)}
                        aria-pressed={selected}
                        className={`w-full text-left p-4 rounded-xl border bg-white dark:bg-gray-900 transition-colors ${
                          selected
                            ? "border-indigo-500 ring-1 ring-indigo-500"
                            : "border-gray-200 dark:border-gray-800 hover:border-indigo-300 dark:hover:border-indigo-700"
                        } ${focusRing}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-sm text-gray-900 dark:text-white line-clamp-1">
                            {item.title}
                          </span>
                          <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                            {item.type === "EXTERNAL" ? "Google Forms" : "Nội bộ"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">
                          {item.publisherEmail ?? item.publisherId}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600 dark:text-gray-300">
                          <span>{item.rewardPerResponse} điểm/lượt</span>
                          <span>Chi phí ký quỹ {item.escrowAmount} điểm</span>
                          <span>Gửi {formatDateTime(item.submittedAt)}</span>
                          {item.isResubmission && (
                            <span className="text-amber-700 dark:text-amber-300 font-medium">
                              Phiên bản mới v{item.versionNumber}
                            </span>
                          )}
                          {item.targetingInvalid && (
                            <span className="text-red-700 dark:text-red-300 font-medium">
                              Tiêu chí nhắm mục tiêu không hợp lệ
                            </span>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {(offset > 0 || hasMore) && (
              <nav aria-label="Phân trang hàng chờ" className="flex justify-between">
                <button
                  type="button"
                  disabled={offset === 0 || queueLoading}
                  onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 ${focusRing}`}
                >
                  ← Trang trước
                </button>
                <button
                  type="button"
                  disabled={!hasMore || queueLoading}
                  onClick={() => setOffset((value) => value + PAGE_SIZE)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 ${focusRing}`}
                >
                  Trang sau →
                </button>
              </nav>
            )}
          </section>

          {/* Preview & decision */}
          <section aria-labelledby="preview-heading" className="lg:col-span-7">
            <h2 id="preview-heading" className="sr-only">
              Xem trước khảo sát
            </h2>
            {!selectedId ? (
              <div className="p-8 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 text-center text-sm text-gray-500 dark:text-gray-400">
                Chọn một khảo sát trong hàng chờ để xem trước và ra quyết định.
              </div>
            ) : previewLoading ? (
              <div aria-busy="true" className="h-72 rounded-xl bg-gray-200/70 dark:bg-gray-800/70 animate-pulse motion-reduce:animate-none" />
            ) : previewError ? (
              <div role="alert" className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm text-red-700 dark:text-red-300 space-y-2">
                <p>{previewError}</p>
                <button
                  type="button"
                  onClick={() => setPreviewKey((key) => key + 1)}
                  className={`text-xs font-semibold underline rounded ${focusRing}`}
                >
                  Thử lại
                </button>
              </div>
            ) : preview ? (
              <article className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm overflow-hidden">
                <div className="p-5 border-b border-gray-100 dark:border-gray-800 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${formStatusBadgeClass(preview.status)}`}>
                      {formStatusLabel(preview.status)}
                    </span>
                    <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                      v{preview.versionNumber}
                    </span>
                    {preview.targetingInvalid && (
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300">
                        Tiêu chí nhắm mục tiêu không hợp lệ
                      </span>
                    )}
                  </div>
                  <h3 className="text-lg font-bold text-gray-900 dark:text-white break-words">
                    {preview.title}
                  </h3>
                  {preview.description && (
                    <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line break-words">
                      {preview.description}
                    </p>
                  )}
                </div>

                <dl className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  {[
                    ["Người đăng", preview.publisherEmail ?? preview.publisherId],
                    ["Loại khảo sát", preview.type === "EXTERNAL" ? "Google Forms (bên ngoài)" : "Biểu mẫu nội bộ"],
                    ["Thưởng mỗi lượt", `${preview.rewardPerResponse} điểm (thực trả ${preview.effectiveRewardPerResponse})`],
                    ["Số lượt cần", `${preview.expectedCompletions}`],
                    ["Chi phí ký quỹ", `${preview.escrowAmount} điểm`],
                    ...(preview.escrowHeld !== null
                      ? [["Ký quỹ đang giữ", `${preview.escrowHeld} điểm`]]
                      : []),
                    ["Thời lượng ước tính", formatMinutes(preview.estimatedEffortSeconds)],
                    ["Số câu hỏi", `${preview.blocksCount}`],
                    ["Gửi kiểm duyệt", formatDateTime(preview.submittedAt)],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
                      <dd className="font-medium text-gray-900 dark:text-white break-words">{value}</dd>
                    </div>
                  ))}
                  <div className="sm:col-span-2 min-w-0">
                    <dt className="text-xs text-gray-500 dark:text-gray-400">Đối tượng mục tiêu</dt>
                    <dd className="font-medium text-gray-900 dark:text-white break-words">
                      {formatTargetingSummary(preview.targetingJson)}
                    </dd>
                  </div>
                  {preview.externalUrl && (
                    <div className="sm:col-span-2 min-w-0">
                      <dt className="text-xs text-gray-500 dark:text-gray-400">Liên kết khảo sát</dt>
                      <dd>
                        <a
                          href={preview.externalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`font-mono text-sm text-indigo-600 dark:text-indigo-400 underline break-all rounded ${focusRing}`}
                        >
                          {preview.externalUrl}
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>

                {preview.type === "INTERNAL" && (
                  <div className="px-5 pb-5">
                    <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">
                      Nội dung biểu mẫu
                    </h4>
                    {parsedDefinition?.success ? (
                      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 p-3 max-h-[32rem] overflow-y-auto">
                        <FormRenderer
                          formId={preview.formId}
                          title={preview.title}
                          description={preview.description ?? undefined}
                          rewardPerResponse={preview.rewardPerResponse}
                          blocks={parsedDefinition.data.blocks}
                          settings={parsedDefinition.data.settings}
                          metadata={parsedDefinition.data.metadata}
                          isPreviewMode={true}
                        />
                      </div>
                    ) : (
                      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                        Không thể hiển thị nội dung biểu mẫu.
                      </p>
                    )}
                  </div>
                )}

                <div className="p-5 border-t border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-800/30 space-y-4">
                  {preview.decision ? (
                    <p className="text-sm text-gray-700 dark:text-gray-200">
                      Đã {preview.decision.outcome === "APPROVED" ? "phê duyệt" : "từ chối"} lúc{" "}
                      {formatDateTime(preview.decision.decidedAt)}
                      {preview.decision.reason ? ` — ${preview.decision.reason}` : ""}.
                    </p>
                  ) : !isQueued ? (
                    <p className="text-sm text-gray-700 dark:text-gray-200">
                      Khảo sát không còn trong hàng chờ kiểm duyệt.
                    </p>
                  ) : (
                    <>
                      {hasFundingShortfall && (
                        <div
                          role="alert"
                          className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-sm text-amber-800 dark:text-amber-200"
                        >
                          Khảo sát chưa được ký quỹ đủ: còn thiếu {preview.fundingShortfall} điểm. Không thể
                          duyệt — hãy từ chối để hoàn phần ký quỹ hiện có.
                        </div>
                      )}
                      {rejectionImpact && (
                        <div
                          id="reject-impact-warning"
                          role="note"
                          className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-sm text-red-800 dark:text-red-200 space-y-1"
                        >
                          <p className="font-semibold">Lưu ý trước khi từ chối bản chỉnh sửa</p>
                          <p>{rejectionImpact}</p>
                        </div>
                      )}
                      <div className="space-y-1">
                        <label htmlFor="approve-note" className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                          Ghi chú khi phê duyệt (không bắt buộc)
                        </label>
                        <input
                          id="approve-note"
                          type="text"
                          value={note}
                          maxLength={500}
                          onChange={(event) => setNote(event.target.value)}
                          className={`w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm ${focusRing}`}
                        />
                      </div>
                      <div className="space-y-1">
                        <label htmlFor="reject-reason" className="block text-xs font-medium text-gray-700 dark:text-gray-200">
                          Lý do từ chối (bắt buộc khi từ chối, gửi tới người đăng)
                        </label>
                        <textarea
                          id="reject-reason"
                          value={reason}
                          rows={3}
                          maxLength={MODERATION_REJECTION_REASON_MAX_LENGTH}
                          onChange={(event) => setReason(event.target.value)}
                          onBlur={() => setReasonTouched(true)}
                          aria-invalid={reasonTouched && Boolean(reasonError)}
                          aria-describedby="reject-reason-help"
                          className={`w-full rounded-lg border bg-white dark:bg-gray-900 px-3 py-2 text-sm ${
                            reasonTouched && reasonError
                              ? "border-red-400 dark:border-red-700"
                              : "border-gray-300 dark:border-gray-700"
                          } ${focusRing}`}
                        />
                        <p
                          id="reject-reason-help"
                          className={`text-xs ${
                            reasonTouched && reasonError ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"
                          }`}
                        >
                          {reasonTouched && reasonError
                            ? reasonError
                            : rejectionImpact
                              ? `${trimmedReason.length}/${MODERATION_REJECTION_REASON_MAX_LENGTH} ký tự. Từ chối sẽ đóng vĩnh viễn toàn bộ khảo sát (xem lưu ý ở trên) và hoàn toàn bộ điểm ký quỹ còn giữ.`
                              : `${trimmedReason.length}/${MODERATION_REJECTION_REASON_MAX_LENGTH} ký tự. Toàn bộ điểm ký quỹ sẽ được hoàn lại khi từ chối.`}
                        </p>
                      </div>

                      {decisionError && (
                        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                          {decisionError}{" "}
                          <button
                            type="button"
                            onClick={() => setPreviewKey((key) => key + 1)}
                            className={`underline font-semibold rounded ${focusRing}`}
                          >
                            Tải lại bản xem trước
                          </button>
                        </p>
                      )}

                      {approveBlockedReason && (
                        <p id="approve-blocked-reason" className="text-xs text-amber-700 dark:text-amber-300">
                          {approveBlockedReason}
                        </p>
                      )}
                      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void handleDecision("reject")}
                          disabled={submitting !== null}
                          aria-describedby={rejectionImpact ? "reject-impact-warning" : undefined}
                          className={`px-4 py-2 text-sm font-semibold rounded-xl border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 ${focusRing}`}
                        >
                          {submitting === "reject"
                            ? "Đang từ chối…"
                            : rejectionImpact
                              ? "Từ chối & đóng vĩnh viễn khảo sát"
                              : "Từ chối & hoàn ký quỹ"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDecision("approve")}
                          disabled={submitting !== null || approveBlockedReason !== null}
                          aria-describedby={approveBlockedReason ? "approve-blocked-reason" : undefined}
                          className={`px-4 py-2 text-sm font-semibold rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 ${focusRing}`}
                        >
                          {submitting === "approve" ? "Đang phê duyệt…" : "Phê duyệt"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </article>
            ) : null}
          </section>
        </div>
      </main>
    </div>
  );
}
