"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  FormBlock,
  FormIntegrityMetadata,
  FormSettings,
} from "@rescom/schemas";
import { FormRenderer } from "../../components/renderer/FormRenderer";
import { mockRepository } from "@/lib/mock/repository.ts";
import type {
  MockSubmissionResult,
  MockTimeBarrierStatus,
} from "@/lib/mock/types.ts";
import { PortalShell } from "@/components/layout/PortalShell";
import { isDemographicProfileRequiredError } from "@/lib/onboarding.ts";
import { useRequireCompletedOnboarding } from "@/lib/use-onboarding-guard.ts";
import {
  describeParticipationGuard,
  getParticipationGuard,
  type ParticipationGuard,
} from "@/lib/participation-guards.ts";
import { TimeBarrierNotice } from "./TimeBarrierNotice";
import { SurveyFeedbackPrompt } from "@/components/feedback/SurveyFeedbackPrompt";

interface RespondPageProps {
  params: Promise<{ id: string }>;
}

export default function SurveyRespondentPage({ params }: RespondPageProps) {
  const router = useRouter();
  const resolvedParams = use(params);
  const formId = resolvedParams.id;
  const searchParams = useSearchParams();
  // Story 7.1 (FR-6): survey taking requires the Mandatory Demographic Survey.
  const { ready, redirectToOnboarding } = useRequireCompletedOnboarding();

  const queryAttemptId = searchParams.get("attemptId");
  const queryResponseId = searchParams.get("responseId");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState<string>("Khảo sát nghiên cứu");
  const [description, setDescription] = useState<string>("");
  const [rewardPerResponse, setRewardPerResponse] = useState<number>(10);
  const [formVersionId, setFormVersionId] = useState<string>("");
  const [blocks, setBlocks] = useState<FormBlock[]>([]);
  const [settings, setSettings] = useState<FormSettings>({
    shuffleBlocks: false,
    progressBar: true,
    requireAuth: true,
    allowPublicAccess: true,
    submitButtonText: "Nộp bài khảo sát",
  });
  const [metadata, setMetadata] = useState<FormIntegrityMetadata>({
    expectedEffortSeconds: 120,
    minTimeBarrierSeconds: 5,
  });

  const [attemptId, setAttemptId] = useState<string | undefined>(
    queryAttemptId || undefined,
  );
  const [responseId, setResponseId] = useState<string | null>(
    queryResponseId ?? null,
  );

  const [submissionResult, setSubmissionResult] = useState<MockSubmissionResult | null>(null);
  // Story 8.2: minimum answering time (server-authoritative) + last rejection.
  const [timeBarrier, setTimeBarrier] = useState<MockTimeBarrierStatus | null>(null);
  const [guard, setGuard] = useState<ParticipationGuard | null>(null);

  useEffect(() => {
    if (!ready) return;
    let active = true;

    async function loadFormAndAttempt() {
      try {
        setLoading(true);
        setError(null);

        // 1. Fetch survey from mockRepository
        const survey = await mockRepository.getSurveyById(formId);
        if (!active) return;
        if (!survey) {
          throw new Error("Không tìm thấy khảo sát này hoặc khảo sát đã bị đóng.");
        }

        setTitle(survey.title);
        setDescription(survey.description || "");
        setRewardPerResponse(survey.rewardPerResponse);
        setFormVersionId(survey.currentVersionId);

        if (survey.blocks && survey.blocks.length > 0) {
          setBlocks(survey.blocks);
        }
        if (survey.settings) {
          setSettings(survey.settings);
        }
        if (survey.metadata) {
          setMetadata(survey.metadata);
        }

        if (survey.type === "EXTERNAL") {
          let currentAttemptId = queryAttemptId;
          if (!currentAttemptId) {
            const newAttempt = await mockRepository.startSurveyAttempt(formId);
            if (!active) return;
            currentAttemptId = newAttempt.attemptId;
          }
          router.replace(`/attempts/${currentAttemptId}`);
          return;
        }

        // 2. Load or initialize attempt
        let currentAttemptId = queryAttemptId;
        let currentResponseId: string | null = queryResponseId ?? null;

        if (!currentAttemptId) {
          const newAttempt = await mockRepository.startSurveyAttempt(formId);
          if (!active) return;
          currentAttemptId = newAttempt.attemptId;
          currentResponseId = newAttempt.responseId ?? null;
          setAttemptId(currentAttemptId);
          setResponseId(currentResponseId);
        }

        const barrierStatus = await mockRepository.getTimeBarrierStatus(currentAttemptId);
        if (!active) return;
        setTimeBarrier(barrierStatus);
      } catch (err: unknown) {
        if (!active) return;
        if (isDemographicProfileRequiredError(err)) {
          redirectToOnboarding();
          return;
        }
        // Story 8.2: e.g. the completion rate limit blocks new attempts.
        const startGuard = getParticipationGuard(err);
        const msg = startGuard
          ? describeParticipationGuard(startGuard)
          : err instanceof Error
            ? err.message
            : "Có lỗi khi tải dữ liệu khảo sát. Vui lòng thử lại.";
        setError(msg);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadFormAndAttempt();

    return () => {
      active = false;
    };
  }, [ready, redirectToOnboarding, formId, queryAttemptId, queryResponseId, router]);

  async function handleSubmitResponse(answers: Record<string, unknown>) {
    if (!attemptId) {
      throw new Error("Không tìm thấy mã lượt làm bài (Attempt ID).");
    }

    // Submit to mock repository (it enforces the Time Barrier and rate limit)
    setGuard(null);
    const result = await mockRepository.submitInternalSurvey(attemptId, answers);
    setSubmissionResult(result);
  }

  /** Story 8.2: bot-protection rejections become a friendly countdown. */
  function handleSubmitError(err: unknown): boolean {
    const rejection = getParticipationGuard(err);
    if (!rejection) return false;
    setGuard(rejection);
    return true;
  }

  if (loading) {
    return (
      <PortalShell>
        <div className="py-24 text-center">
          <div className="w-10 h-10 border-3 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs font-semibold text-slate-500">Đang chuẩn bị biểu mẫu khảo sát...</p>
        </div>
      </PortalShell>
    );
  }

  if (error) {
    return (
      <PortalShell>
        <div className="max-w-md mx-auto px-4 py-16 text-center">
          <div className="bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/60 rounded-3xl p-8 shadow-xs">
            <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 rounded-2xl flex items-center justify-center mx-auto mb-4 text-xl">
              ⚠️
            </div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white mb-2">
              Không thể tham gia khảo sát
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
              {error}
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

  // Celebratory Settlement Receipt Screen
  if (submissionResult) {
    return (
      <PortalShell>
        <div className="max-w-xl mx-auto px-4 py-12 text-center animate-in zoom-in-95 duration-200">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-emerald-200 dark:border-emerald-900 p-8 sm:p-10 shadow-xl">
            <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 rounded-3xl flex items-center justify-center text-3xl mx-auto mb-4">
              🎉
            </div>

            <h2 className="text-xl font-black text-slate-900 dark:text-white mb-2">
              Nộp Bài Thành Công!
            </h2>

            <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
              Cảm ơn bạn đã đóng góp câu trả lời chất lượng cho đề tài nghiên cứu này. Câu trả lời của bạn đã được ghi nhận an toàn trên hệ thống RESCOM.
            </p>

            {/* Instant Reward Badge */}
            <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 mb-6 text-left">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                  Thưởng Khảo Sát Nội Bộ (Cộng Ngay):
                </span>
                <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                  +{submissionResult.rewardEarned} Điểm Khả Dụng
                </span>
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                Số dư khả dụng hiện tại:{" "}
                <strong className="text-slate-800 dark:text-slate-200">
                  {submissionResult.newBalance.available} điểm
                </strong>
              </div>
            </div>

            {/* Starter Points Unlock Celebration if applicable */}
            {submissionResult.unlockedStarterPoints && (
              <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/40 border border-amber-200 dark:border-amber-900 mb-6 text-left">
                <div className="flex items-start gap-2.5">
                  <span className="text-2xl">🎁</span>
                  <div>
                    <h3 className="text-xs font-black text-amber-900 dark:text-amber-200">
                      CHÚC MỪNG BẠN ĐÃ MỞ KHÓA 100 ĐIỂM TÂN THỦ!
                    </h3>
                    <p className="text-[11px] text-amber-800 dark:text-amber-300 mt-1 leading-relaxed">
                      Bạn đã hoàn tất cả 2 điều kiện: Hồ sơ nhân khẩu học + 1 khảo sát đầu tiên. Toàn bộ 100 Điểm Khóa đã được chuyển vĩnh viễn sang Số Dư Khả Dụng!
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Story 9.2 (FR-43): optional post-completion feedback prompt */}
            <SurveyFeedbackPrompt
              attemptId={submissionResult.attemptId}
              surveyTitle={title}
            />

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/marketplace"
                className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-600/20 transition-all"
              >
                Làm Khảo Sát Khác &rarr;
              </Link>
              <Link
                href="/wallet"
                className="px-5 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Kiểm tra Ví Điểm
              </Link>
              <Link
                href="/dashboard"
                className="px-5 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 transition-colors"
              >
                Về Bảng Điều Khiển
              </Link>
            </div>
          </div>
        </div>
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
          >
            <span>&larr;</span>
            <span>Quay lại Chợ khảo sát</span>
          </Link>

          <div className="flex items-center gap-2">
            {timeBarrier && timeBarrier.requiredSeconds > 0 && (
              <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                <span aria-hidden="true">⏱ </span>Tối thiểu {timeBarrier.requiredSeconds} giây
              </span>
            )}
            <span className="text-[11px] font-medium text-slate-400 dark:text-slate-600">
              Lượt khảo sát: {attemptId?.slice(0, 10)}...
            </span>
          </div>
        </div>

        <FormRenderer
          formId={formId}
          attemptId={attemptId}
          responseId={responseId}
          formVersionId={formVersionId}
          title={title}
          description={description}
          rewardPerResponse={rewardPerResponse}
          blocks={blocks}
          settings={settings}
          metadata={metadata}
          isPreviewMode={false}
          isGuestMode={false}
          onSubmitResponse={handleSubmitResponse}
          onSubmitError={handleSubmitError}
          renderBeforeSubmit={<TimeBarrierNotice barrier={timeBarrier} guard={guard} />}
        />
      </div>
    </PortalShell>
  );
}
