"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MarketplaceSurveyCardDto } from "@rescom/schemas";
import { mockRepository } from "@/lib/mock/repository.ts";
import {
  buildOnboardingRedirect,
  isDemographicProfileRequiredError,
} from "@/lib/onboarding.ts";

interface MarketplaceCardProps {
  survey: MarketplaceSurveyCardDto;
}

export function MarketplaceCard({ survey }: MarketplaceCardProps) {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const effortMinutes = Math.max(1, Math.round(survey.estimatedEffortSeconds / 60));

  const handleStartSurvey = async () => {
    setIsStarting(true);
    setErrorMessage(null);
    try {
      const attempt = await mockRepository.startSurveyAttempt(survey.id);
      if (survey.type === "INTERNAL") {
        router.push(
          `/forms/${survey.id}/respond?attemptId=${attempt.attemptId}&responseId=${attempt.responseId || ""}`,
        );
      } else {
        if (attempt.externalUrl) {
          // No opener/referrer for third-party survey hosts (reverse
          // tabnabbing), matching ActivationCard and /attempts/[id].
          window.open(attempt.externalUrl, "_blank", "noopener,noreferrer");
        }
        router.push(`/attempts/${attempt.attemptId}`);
      }
    } catch (err: unknown) {
      // Story 7.1: earning requires the Mandatory Demographic Survey first.
      if (isDemographicProfileRequiredError(err)) {
        router.replace(buildOnboardingRedirect("/marketplace"));
        return;
      }
      const msg =
        err instanceof Error
          ? err.message
          : "Không thể bắt đầu lượt làm khảo sát. Vui lòng thử lại.";
      setErrorMessage(msg);
    } finally {
      setIsStarting(false);
    }
  };

  const targeting = survey.targetingJson;
  const criteriaSummaries: string[] = [];

  if (targeting) {
    if (targeting.ageRange) {
      criteriaSummaries.push(
        targeting.ageRange.min === targeting.ageRange.max
          ? `Tuổi ${targeting.ageRange.min}`
          : `Tuổi ${targeting.ageRange.min}–${targeting.ageRange.max}`,
      );
    }
    if (targeting.locations && targeting.locations.length > 0) {
      criteriaSummaries.push(targeting.locations.join(", "));
    }
    if (targeting.genders && targeting.genders.length > 0) {
      const genderLabels: Record<string, string> = {
        MALE: "Nam",
        FEMALE: "Nữ",
        OTHER: "Khác",
        PREFER_NOT_TO_SAY: "Bảo mật",
      };
      criteriaSummaries.push(
        targeting.genders.map((g) => genderLabels[g] || g).join(", "),
      );
    }
    if (targeting.occupations && targeting.occupations.length > 0) {
      criteriaSummaries.push(targeting.occupations.join(", "));
    }
    if (targeting.fieldOfStudy && targeting.fieldOfStudy.length > 0) {
      criteriaSummaries.push(targeting.fieldOfStudy.join(", "));
    }
  }

  return (
    <div
      className={`flex flex-col justify-between bg-white dark:bg-slate-900 border rounded-3xl p-5 shadow-xs transition-all ${
        survey.isCompletedByCurrentUser
          ? "border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10"
          : "border-slate-200 dark:border-slate-800 hover:border-emerald-400 dark:hover:border-emerald-600 hover:shadow-md hover:shadow-emerald-500/5"
      }`}
    >
      <div>
        {/* Top Badges */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase ${
                survey.type === "INTERNAL"
                  ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-900"
                  : "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border border-purple-200 dark:border-purple-900"
              }`}
            >
              {survey.type === "INTERNAL" ? "RESCOM Nội bộ" : "Google Forms"}
            </span>

            {survey.isCompletedByCurrentUser && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                <span>✓</span>
                <span>Đã nộp</span>
              </span>
            )}
          </div>

          <span className="inline-flex items-center gap-1 font-black text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-0.5 rounded-full border border-amber-200/60 dark:border-amber-900/60">
            <span>🪙</span>
            <span>+{survey.rewardPerResponse} pts</span>
          </span>
        </div>

        {/* Title & Description */}
        <h3
          className="text-sm font-bold text-slate-900 dark:text-white line-clamp-1 mb-1.5"
          title={survey.title}
        >
          {survey.title}
        </h3>

        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mb-4 h-8 leading-relaxed">
          {survey.description || "Khảo sát nghiên cứu học thuật sinh viên."}
        </p>

        {/* Targeting criteria match info */}
        <div className="mb-4 pt-3 border-t border-slate-100 dark:border-slate-800">
          {survey.hasTargeting ? (
            <div>
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-400 mb-1.5">
                <svg
                  className="w-3.5 h-3.5 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>Đối tượng phù hợp với bạn</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {criteriaSummaries.map((summary, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium"
                  >
                    {summary}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              <span>🌐</span>
              <span>Mở rộng cho tất cả sinh viên</span>
            </div>
          )}
        </div>
      </div>

      {/* Footer & Action */}
      <div>
        <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 mb-1">
          <span className="flex items-center gap-1">
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            ~{effortMinutes} phút
          </span>

          {survey.isCompletedByCurrentUser ? (
            <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-bold text-xs cursor-default">
              <span>Đã hoàn thành</span>
              <span>✓</span>
            </span>
          ) : (
            <button
              type="button"
              onClick={handleStartSurvey}
              disabled={isStarting}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold shadow-xs transition-colors text-xs cursor-pointer"
            >
              {isStarting ? (
                <>
                  <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Đang mở...</span>
                </>
              ) : (
                <>
                  <span>Bắt đầu</span>
                  <span>&rarr;</span>
                </>
              )}
            </button>
          )}
        </div>

        {errorMessage && (
          <div className="mt-2.5 p-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-[11px] text-rose-700 dark:text-rose-300 flex items-center justify-between">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="ml-2 text-rose-500 hover:text-rose-700 font-bold cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
