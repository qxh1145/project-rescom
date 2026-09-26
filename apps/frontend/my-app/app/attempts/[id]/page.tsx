"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  MAX_COMPLETION_CODE_ATTEMPTS,
  mockRepository,
  type MockRepositoryError,
} from "@/lib/mock/repository.ts";
import type {
  MockSurvey,
  MockSurveyAttempt,
  MockSubmissionResult,
} from "@/lib/mock/types.ts";
import { PortalShell } from "@/components/layout/PortalShell";
import { SurveyFeedbackPrompt } from "@/components/feedback/SurveyFeedbackPrompt";
import { useRequireCompletedOnboarding } from "@/lib/use-onboarding-guard.ts";
import {
  formatVnDateTime,
  isActivationWindowOpen,
  receiptActivationNotice,
} from "@/lib/activation.ts";
import {
  describeParticipationGuard,
  getParticipationGuard,
} from "@/lib/participation-guards.ts";

interface AttemptPageProps {
  params: Promise<{ id: string }>;
}

export default function ExternalAttemptPage({ params }: AttemptPageProps) {
  const resolvedParams = use(params);
  const attemptId = resolvedParams.id;
  // Story 7.1 (FR-6): survey taking requires the Mandatory Demographic Survey.
  const { ready } = useRequireCompletedOnboarding();

  const [attempt, setAttempt] = useState<MockSurveyAttempt | null>(null);
  const [survey, setSurvey] = useState<MockSurvey | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  // Decision E5-D1: tries left also count this version's earlier attempts
  // (6 per account and version); null = derive from this attempt only.
  const [remainingTries, setRemainingTries] = useState<number | null>(null);

  // Countdown & Time barrier state
  const [countdown, setCountdown] = useState<number>(0);
  const [hasOpenedLink, setHasOpenedLink] = useState(false);

  // Completion code input state
  const [inputCode, setInputCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Missing code report state
  const [isReporting, setIsReporting] = useState(false);
  const [reportReason, setReportReason] = useState(
    "Google Form không hiển thị mã xác nhận tại trang cảm ơn cuối cùng.",
  );
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportSuccess, setReportSuccess] = useState<string | null>(null);

  // Settlement Result state
  const [submissionResult, setSubmissionResult] =
    useState<MockSubmissionResult | null>(null);

  useEffect(() => {
    if (!ready) return;
    let active = true;

    async function loadAttempt() {
      try {
        setLoading(true);
        setError(null);

        const data = await mockRepository.getAttempt(attemptId);
        if (!active) return;
        if (!data) {
          throw new Error("Lượt khảo sát không tồn tại hoặc đã hết hạn.");
        }

        setAttempt(data.attempt);
        setSurvey(data.survey);

        if (data.attempt.status === "COMPLETED") {
          // Already completed
          const walletDetails = await mockRepository.getWalletDetails();
          // Code review P10: keep the "unlock after the 48 h review" notice
          // when the receipt is reopened (non-fatal: no notice on error).
          const activationStatus = await mockRepository
            .getActivationStatus()
            .then((result) => result.status)
            .catch(() => null);
          if (!active) return;
          setSubmissionResult({
            success: true,
            attemptId,
            rewardEarned: data.survey.rewardPerResponse,
            rewardType: "PENDING",
            pendingHours: 48,
            unlockedStarterPoints: false,
            activation: receiptActivationNotice(activationStatus, data.survey.id),
            newBalance: walletDetails.balance,
            message: "Lượt khảo sát này đã hoàn tất trước đó.",
          });
          return;
        }

        setFailedAttempts(data.attempt.failedCodeAttempts ?? 0);
        if (data.attempt.status === "LOCKED") {
          setIsLocked(true);
          setCodeError("Lượt khảo sát này đã bị KHÓA do nhập sai mã hoàn thành.");
        } else {
          const tries =
            await mockRepository.getRemainingCompletionCodeTries(attemptId);
          if (!active) return;
          setRemainingTries(tries);
        }

        // Story 8.2: the repository (server) owns the Time Barrier; the page
        // only counts down to the time it reports.
        const barrier = await mockRepository.getTimeBarrierStatus(attemptId);
        if (!active) return;
        setCountdown(barrier?.remainingSeconds ?? 0);
      } catch (err: unknown) {
        if (!active) return;
        const msg =
          err instanceof Error
            ? err.message
            : "Có lỗi khi tải lượt khảo sát.";
        setError(msg);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadAttempt();

    return () => {
      active = false;
    };
  }, [ready, attemptId]);

  // Countdown timer effect
  useEffect(() => {
    if (countdown <= 0) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [countdown]);

  function handleOpenExternalForm() {
    setHasOpenedLink(true);
    if (survey?.externalUrl) {
      window.open(survey.externalUrl, "_blank", "noopener,noreferrer");
    }
  }

  async function handleSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    setCodeError(null);

    if (isLocked) {
      setCodeError(
        "Lượt khảo sát này đã bị KHÓA do nhập sai mã 3 lần. Bạn không thể tiếp tục gửi mã cho lượt này.",
      );
      return;
    }

    if (countdown > 0) {
      setCodeError(
        `Vui lòng chờ hết thời gian đếm ngược (${countdown}s) để bảo đảm bạn đã thực sự hoàn thành biểu mẫu.`,
      );
      return;
    }

    if (!/^\d{6}$/.test(inputCode.trim())) {
      setCodeError("Vui lòng nhập mã hoàn thành gồm 6 chữ số.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await mockRepository.submitExternalSurvey(
        attemptId,
        inputCode.trim(),
      );
      setSubmissionResult(res);
    } catch (err: unknown) {
      const repoError = err as MockRepositoryError;
      const failed = repoError?.details?.failedCodeAttempts;
      if (typeof failed === "number") {
        setFailedAttempts(failed);
      }
      const remaining = repoError?.details?.remainingAttempts;
      if (typeof remaining === "number") {
        setRemainingTries(remaining);
      }
      if (
        repoError?.code === "ATTEMPT_LOCKED" ||
        repoError?.code === "COMPLETION_CODE_LIMIT_REACHED"
      ) {
        setIsLocked(true);
      }
      // Story 8.2: Time Barrier / rate-limit rejections never cost a code try.
      const guard = getParticipationGuard(err);
      if (guard?.kind === "TIME_BARRIER") {
        setCountdown(guard.remainingSeconds);
      }
      const msg = guard
        ? describeParticipationGuard(guard)
        : err instanceof Error
          ? err.message
          : "Xác nhận mã không thành công. Vui lòng kiểm tra lại.";
      setCodeError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReportSubmit(e: React.FormEvent) {
    e.preventDefault();
    setReportSubmitting(true);
    try {
      const res = await mockRepository.reportMissingCode(
        attemptId,
        reportReason.trim(),
      );
      setReportSuccess(res.message);
      setIsReporting(false);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gửi báo cáo thất bại.";
      alert(msg);
    } finally {
      setReportSubmitting(false);
    }
  }

  if (loading) {
    return (
      <PortalShell>
        <div className="py-24 text-center">
          <div className="w-10 h-10 border-3 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs font-semibold text-slate-500">
            Đang tải thông tin biểu mẫu ngoài...
          </p>
        </div>
      </PortalShell>
    );
  }

  if (error || !survey || !attempt) {
    return (
      <PortalShell>
        <div className="max-w-md mx-auto px-4 py-16 text-center">
          <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 rounded-3xl p-8 shadow-xs">
            <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-2xl flex items-center justify-center mx-auto mb-4 text-xl">
              ⚠️
            </div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white mb-2">
              Không tìm thấy lượt khảo sát
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
              {error || "Lượt khảo sát không hợp lệ."}
            </p>
            <Link
              href="/marketplace"
              className="inline-flex items-center justify-center px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors"
            >
              Quay lại Chợ khảo sát
            </Link>
          </div>
        </div>
      </PortalShell>
    );
  }

  // Celebratory Settlement Receipt Screen (External 48h Pending)
  if (submissionResult) {
    return (
      <PortalShell>
        <div className="max-w-xl mx-auto px-4 py-12 text-center animate-in zoom-in-95 duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-purple-200 dark:border-purple-900 p-8 sm:p-10 shadow-xl">
            <div className="w-16 h-16 bg-purple-100 dark:bg-purple-950/80 text-purple-600 dark:text-purple-400 rounded-3xl flex items-center justify-center text-3xl mx-auto mb-4">
              ⏳
            </div>

            <h2 className="text-xl font-black text-slate-900 dark:text-white mb-2">
              Xác Nhận Mã Thành Công!
            </h2>

            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
              Mã xác nhận của bạn hoàn toàn chính xác. Do đây là khảo sát thực hiện trên Google Forms, điểm thưởng sẽ được giữ ở trạng thái <strong>Chờ Duyệt (Pending)</strong> để bảo đảm chất lượng dữ liệu.
            </p>

            {/* Pending Receipt Box */}
            <div className="p-5 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-900/60 mb-6 text-left space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-purple-200/60 dark:border-purple-900/40">
                <span className="text-xs font-bold text-purple-900 dark:text-purple-200">
                  Thưởng Khảo Sát Ngoài:
                </span>
                <span className="text-sm font-black text-purple-700 dark:text-purple-300">
                  +{submissionResult.rewardEarned} Điểm Chờ Duyệt (Pending)
                </span>
              </div>

              <div className="text-[11px] text-slate-600 dark:text-slate-400 space-y-1.5 leading-relaxed">
                <div className="flex items-center justify-between">
                  <span>Thời gian chờ đối soát:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    48 giờ
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Cơ chế giải ngân tự động:</span>
                  <span className="text-slate-700 dark:text-slate-300">
                    Tự động chuyển sang Khả Dụng sau 48h nếu Publisher không khiếu nại.
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-purple-100 dark:border-purple-900/40">
                  <span>Tổng số dư đang chờ duyệt:</span>
                  <strong className="text-purple-700 dark:text-purple-300">
                    {submissionResult.newBalance.pending} điểm
                  </strong>
                </div>
              </div>
            </div>

            {/* Unlock Celebration if applicable */}
            {submissionResult.unlockedStarterPoints && (
              <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/40 border border-amber-200 dark:border-amber-900 mb-6 text-left">
                <div className="flex items-start gap-2.5">
                  <span className="text-2xl">🎁</span>
                  <div>
                    <h3 className="text-xs font-black text-amber-900 dark:text-amber-200">
                      MỞ KHÓA THÀNH CÔNG 100 ĐIỂM TÂN THỦ!
                    </h3>
                    <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-1 leading-relaxed">
                      Chúc mừng bạn đã hoàn thành khảo sát đầu tiên. 100 Điểm Khóa chào mừng đã được chuyển thành <strong>100 Điểm Khả Dụng</strong> ngay lập tức!
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Activation step pending the 48h review (Story 7.2) */}
            {!submissionResult.unlockedStarterPoints &&
              submissionResult.activation?.state === "PENDING_CONFIRMATION" && (
                <div
                  role="status"
                  className="p-4 rounded-2xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-900 mb-6 text-left"
                >
                  <div className="flex items-start gap-2.5">
                    <span className="text-2xl" aria-hidden="true">🔓</span>
                    <div>
                      <h3 className="text-xs font-black text-sky-900 dark:text-sky-200">
                        100 ĐIỂM TÂN THỦ SẼ MỞ KHÓA SAU 48 GIỜ ĐỐI SOÁT
                      </h3>
                      <p className="text-[11px] text-sky-800 dark:text-sky-300 mt-1 leading-relaxed">
                        Khảo sát Google Forms được tính cho bước kích hoạt tài khoản khi hết thời gian đối soát
                        {submissionResult.activation.confirmsAt
                          ? ` (dự kiến ${formatVnDateTime(submissionResult.activation.confirmsAt)})`
                          : ""}
                        .
                        {/* Code review P7: "unlock now" only while the 30-day window is open. */}
                        {isActivationWindowOpen(submissionResult.activation)
                          ? " Muốn mở khóa ngay? Hoàn thành 1 khảo sát nội bộ RESCOM."
                          : ""}
                      </p>
                      {isActivationWindowOpen(submissionResult.activation) && (
                        <Link
                          href="/marketplace?activation=1"
                          className="inline-block mt-2 text-[11px] font-bold text-sky-700 dark:text-sky-300 hover:underline rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                        >
                          Xem khảo sát nội bộ gợi ý &rarr;
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              )}

            {/* Story 9.2 (FR-43): optional post-completion feedback prompt */}
            <SurveyFeedbackPrompt attemptId={attemptId} surveyTitle={survey.title} />

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/marketplace"
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-600/20 transition-all"
              >
                Khám phá khảo sát khác &rarr;
              </Link>
              <Link
                href="/wallet"
                className="px-5 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Kiểm tra Ví điểm
              </Link>
              <Link
                href="/dashboard"
                className="px-5 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 transition-colors"
              >
                Về Bảng điều khiển
              </Link>
            </div>
          </div>
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Back Link */}
        <div className="mb-4">
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            <span>&larr;</span>
            <span>Quay lại Chợ khảo sát</span>
          </Link>
        </div>

        {/* Survey Summary Header Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xs mb-6">
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-200 dark:border-purple-900">
              Biểu mẫu ngoài (Google Forms)
            </span>
            <span className="font-black text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-1 rounded-full border border-amber-200/60 dark:border-amber-900/60">
              🪙 +{survey.rewardPerResponse} Điểm thưởng (Pending 48h)
            </span>
          </div>

          <h1 className="text-lg font-black text-slate-900 dark:text-white mb-2">
            {survey.title}
          </h1>

          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mb-4">
            {survey.description}
          </p>

          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-3 border-t border-slate-100 dark:border-slate-800">
            <div>
              Đăng bởi:{" "}
              <strong className="text-slate-700 dark:text-slate-300">
                {survey.publisherName}
              </strong>
            </div>
            <div>•</div>
            <div>
              Thời gian ước lượng:{" "}
              <strong className="text-slate-700 dark:text-slate-300">
                ~{Math.max(1, Math.round(survey.estimatedEffortSeconds / 60))} phút
              </strong>
            </div>
          </div>
        </div>

        {/* Step-by-Step Experience Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xs space-y-6">
          {/* Step 1: Open Google Form */}
          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-2xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold text-xs shrink-0">
              1
            </div>
            <div className="flex-1">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white mb-1">
                Mở và hoàn thành biểu mẫu trên Google Forms
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">
                Bấm nút bên dưới để mở liên kết Google Forms trong một tab trình duyệt mới. Sau khi bấm nút Gửi trên Google Form, hãy chú ý sao chép mã 6 ký tự hiển thị ở màn hình cảm ơn.
              </p>

              <button
                type="button"
                onClick={handleOpenExternalForm}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs shadow-sm transition-all cursor-pointer"
              >
                <span>Mở Google Form trong tab mới</span>
                <span>↗</span>
              </button>

              {hasOpenedLink && (
                <span className="inline-flex items-center gap-1 ml-3 text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                  <span>✓</span> Đã mở liên kết
                </span>
              )}
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800" />

          {/* Step 2: Time barrier countdown */}
          <div className="flex items-start gap-4">
            <div
              className={`w-8 h-8 rounded-2xl flex items-center justify-center font-bold text-xs shrink-0 ${
                countdown > 0
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              }`}
            >
              2
            </div>
            <div className="flex-1">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white mb-1">
                Thời gian làm bài tối thiểu (Anti-Fraud Barrier)
              </h3>

              {countdown > 0 ? (
                <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 text-xs">
                  <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
                    <span className="animate-pulse">⏱️</span>
                    <span>Đang đếm ngược: còn {countdown} giây</span>
                  </div>
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1 leading-relaxed">
                    Hệ thống yêu cầu thời gian hoàn thành tối thiểu để bảo đảm tính trung thực của phản hồi nghiên cứu. Nút nộp mã sẽ mở khi bộ đếm về 0.
                  </p>
                </div>
              ) : (
                <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-xs text-emerald-800 dark:text-emerald-300 font-bold flex items-center gap-2">
                  <span>✓</span>
                  <span>Đã đạt thời gian làm bài hợp lệ. Bạn có thể nộp mã xác nhận ngay!</span>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800" />

          {/* Step 3: Enter completion code */}
          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-2xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 flex items-center justify-center font-bold text-xs shrink-0">
              3
            </div>
            <div className="flex-1">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white mb-1">
                Nhập mã hoàn thành (Completion Code)
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">
                Nhập chính xác mã 6 ký tự được Publisher cung cấp ở cuối biểu mẫu.
              </p>

              {/* Demo Hint Banner */}
              {survey.completionCode && (
                <div className="mb-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] text-slate-600 dark:text-slate-300 flex items-center justify-between">
                  <span>
                    💡 Mẹo thử nghiệm Demo: Mã của khảo sát này là{" "}
                    <strong className="text-emerald-600 dark:text-emerald-400 font-mono tracking-wider">
                      {survey.completionCode}
                    </strong>
                  </span>
                  <button
                    type="button"
                    onClick={() => setInputCode(survey.completionCode || "")}
                    className="text-emerald-600 dark:text-emerald-400 font-bold underline ml-2 cursor-pointer"
                  >
                    Tự điền mã
                  </button>
                </div>
              )}

              {isLocked && (
                <div className="mb-4 p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 text-xs flex items-center gap-2.5">
                  <span className="text-base shrink-0">🔒</span>
                  <span>
                    Lượt làm bài này đã bị KHÓA do nhập sai mã 3 lần. Nếu bạn gặp trục trặc kỹ thuật hoặc Publisher quên để mã, hãy sử dụng tính năng báo cáo bên dưới.
                  </span>
                </div>
              )}

              <form onSubmit={handleSubmitCode} className="space-y-3">
                <div>
                  <label htmlFor="completion-code" className="sr-only">
                    Mã hoàn thành 6 chữ số
                  </label>
                  <input
                    id="completion-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="\d{6}"
                    maxLength={6}
                    disabled={isLocked || submitting}
                    value={inputCode}
                    onChange={(e) => {
                      setInputCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                      setCodeError(null);
                    }}
                    placeholder="Ví dụ: 123456"
                    className="w-full sm:w-64 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 text-sm font-mono font-bold tracking-widest text-slate-900 dark:text-white uppercase placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  {codeError && (
                    <p
                      role="alert"
                      className="text-xs text-rose-500 font-medium mt-1.5 leading-relaxed"
                    >
                      {codeError}
                    </p>
                  )}
                  {!isLocked && (
                    <p
                      aria-live="polite"
                      className={`text-[11px] font-semibold mt-1.5 ${
                        failedAttempts > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      Còn{" "}
                      {remainingTries ??
                        MAX_COMPLETION_CODE_ATTEMPTS - failedAttempts}
                      /{MAX_COMPLETION_CODE_ATTEMPTS} lần nhập mã trước khi lượt
                      làm bài bị khóa.
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={
                      submitting || countdown > 0 || inputCode.length !== 6 || isLocked
                    }
                    className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-all cursor-pointer flex items-center gap-2"
                  >
                    {submitting ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        <span>Đang xác nhận mã...</span>
                      </>
                    ) : (
                      <span>Nộp mã nhận điểm thưởng</span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsReporting(!isReporting)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline transition-colors cursor-pointer"
                  >
                    Không tìm thấy mã hoàn thành?
                  </button>
                </div>
              </form>

              {/* Missing Code Report Card */}
              {isReporting && (
                <div className="mt-4 p-4 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 text-xs animate-in fade-in duration-150">
                  <h4 className="font-bold text-slate-900 dark:text-white mb-1">
                    Báo cáo khảo sát không có mã hoàn thành
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">
                    Nếu bạn đã hoàn thành biểu mẫu nhưng Publisher quên không để mã ở trang cảm ơn, hãy gửi báo cáo này. Quản trị viên sẽ rà soát và cộng điểm cho bạn.
                  </p>

                  <form onSubmit={handleReportSubmit} className="space-y-3">
                    <textarea
                      rows={2}
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                      placeholder="Mô tả sự cố (VD: Google Form chỉ hiện 'Câu trả lời của bạn đã được ghi lại' mà không có mã)..."
                      className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    />

                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={reportSubmitting}
                        className="px-3.5 py-1.5 rounded-lg bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 font-bold text-xs hover:opacity-90 transition-opacity cursor-pointer"
                      >
                        {reportSubmitting ? "Đang gửi..." : "Gửi báo cáo sự cố"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsReporting(false)}
                        className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800 transition-colors"
                      >
                        Đóng
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Report success notice */}
              {reportSuccess && (
                <div className="mt-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300 text-xs">
                  {reportSuccess}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </PortalShell>
  );
}
