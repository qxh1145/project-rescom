"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mockRepository } from "@/lib/mock/repository.ts";
import type { MockUser } from "@/lib/mock/types.ts";
import type {
  MarketplaceSurveyCardDto,
  StarterPointsStatusDto,
  WalletBalanceDto,
} from "@rescom/schemas";
import { PortalShell } from "@/components/layout/PortalShell";
import { ActivationCard } from "@/components/activation/ActivationCard";
import {
  buildOnboardingRedirect,
  isDemographicProfileRequiredError,
} from "@/lib/onboarding.ts";
import { memberStatusBadge } from "@/lib/activation.ts";

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<MockUser | null>(null);
  const [wallet, setWallet] = useState<WalletBalanceDto | null>(null);
  const [recommendedSurveys, setRecommendedSurveys] = useState<MarketplaceSurveyCardDto[]>([]);
  const [activationStatus, setActivationStatus] = useState<StarterPointsStatusDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadDashboard() {
      try {
        const currentUser = await mockRepository.getCurrentUser();
        if (!active) return;
        if (!currentUser) {
          router.push("/login");
          return;
        }
        setUser(currentUser);

        // Story 7.1: the Marketplace feed stays locked until the Mandatory
        // Demographic Survey is complete, so only onboarded users load it.
        // Code review P8: wallet and feed load independently — a feed error
        // never blanks the wallet, and a gate rejection (profile incomplete
        // after all) sends the user to onboarding instead of failing silently.
        const [walletResult, feedResult] = await Promise.allSettled([
          mockRepository.getWalletDetails(),
          currentUser.isOnboarded
            ? mockRepository.getMarketplaceFeed({ hideCompleted: true })
            : Promise.resolve(null),
        ]);

        if (!active) return;
        if (walletResult.status === "fulfilled") {
          setWallet(walletResult.value.balance);
        } else {
          console.error("Failed to load dashboard wallet:", walletResult.reason);
        }
        if (feedResult.status === "fulfilled") {
          setRecommendedSurveys(feedResult.value ? feedResult.value.surveys.slice(0, 3) : []);
        } else if (isDemographicProfileRequiredError(feedResult.reason)) {
          router.replace(buildOnboardingRedirect("/dashboard"));
          return;
        } else {
          console.error("Failed to load dashboard recommendations:", feedResult.reason);
          setRecommendedSurveys([]);
        }
      } catch (err) {
        console.error("Failed to load dashboard:", err);
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadDashboard();

    return () => {
      active = false;
    };
  }, [router]);

  async function handleStartSurvey(survey: MarketplaceSurveyCardDto) {
    setStartError(null);
    try {
      const attempt = await mockRepository.startSurveyAttempt(survey.id);
      if (survey.type === "INTERNAL") {
        router.push(
          `/forms/${survey.id}/respond?attemptId=${attempt.attemptId}&responseId=${attempt.responseId || ""}`,
        );
      } else {
        router.push(`/attempts/${attempt.attemptId}`);
      }
    } catch (err) {
      if (isDemographicProfileRequiredError(err)) {
        router.replace(buildOnboardingRedirect("/dashboard"));
        return;
      }
      // Story 8.2: e.g. the completion rate limit (friendly mock/API message).
      setStartError(
        err instanceof Error
          ? err.message
          : "Không thể bắt đầu khảo sát. Vui lòng thử lại.",
      );
    }
  }

  if (loading) {
    return (
      <PortalShell>
        <div className="py-24 text-center">
          <div className="w-10 h-10 border-3 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs font-semibold text-slate-500">Đang tải bảng điều khiển...</p>
        </div>
      </PortalShell>
    );
  }

  const isOnboarded = user?.isOnboarded ?? false;
  const activationState = activationStatus?.activationState;
  // Starter points unlocked (drives the Frozen-points hint only).
  const isActivated =
    activationState === "ACTIVATED" || (user?.isActivated ?? false);
  // FR-7 "Verified Member" (decision E7-DN3): both onboarding steps done,
  // independent of the starter points' 30-day expiry.
  const memberBadge = memberStatusBadge(activationStatus, user?.isActivated ?? false);
  const frozenHint =
    wallet && wallet.frozen > 0
      ? "Mở khóa khi kích hoạt"
      : isActivated
        ? "Đã mở khóa toàn bộ ✓"
        : activationState === "EXPIRED"
          ? "Đã hết hạn sau 30 ngày"
          : "Không có điểm khóa";

  return (
    <PortalShell>
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Welcome Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">
                Xin chào, {user?.name || "Bạn"}! 👋
              </h1>
              {memberBadge.verified ? (
                <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  {memberBadge.label}
                </span>
              ) : (
                <span className="px-2 py-0.5 text-[11px] font-bold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                  {memberBadge.label}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Theo dõi tiến độ kích hoạt, số dư điểm thưởng và các khảo sát nghiên cứu học thuật phù hợp.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/marketplace"
              className="px-4 py-2 text-xs font-bold rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-all"
            >
              🎯 Khám phá Chợ Khảo sát
            </Link>
            <Link
              href="/forms"
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              📋 Tạo khảo sát
            </Link>
          </div>
        </div>

        {/* Activation step (Story 7.2): data-driven progress, recommendations, success state */}
        <ActivationCard variant="dashboard" onStatusChange={setActivationStatus} />

        {/* Balance Cards Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {/* Available */}
          <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span className="font-semibold">Điểm Khả Dụng</span>
              <span className="p-1 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 text-sm">
                🪙
              </span>
            </div>
            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
              {wallet?.available ?? 0}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Có thể dùng để tạo khảo sát ngay</p>
          </div>

          {/* Pending */}
          <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span className="font-semibold">Chờ Duyệt (Pending)</span>
              <span className="p-1 rounded-md bg-purple-50 dark:bg-purple-950/60 text-purple-600 text-sm">
                ⏳
              </span>
            </div>
            <div className="text-2xl font-black text-purple-600 dark:text-purple-400">
              {wallet?.pending ?? 0}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Từ khảo sát ngoài (Duyệt sau 48h)</p>
          </div>

          {/* Frozen */}
          <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span className="font-semibold">Điểm Khóa (Frozen)</span>
              <span className="p-1 rounded-md bg-sky-50 dark:bg-sky-950/60 text-sky-600 text-sm">
                ❄️
              </span>
            </div>
            <div className="text-2xl font-black text-sky-600 dark:text-sky-400">
              {wallet?.frozen ?? 0}
            </div>
            <p className="text-[11px] text-slate-400 mt-1">{frozenHint}</p>
          </div>

          {/* Streak & Gamification */}
          <div className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
              <span className="font-semibold">Chuỗi Ngày (Streak)</span>
              <span className="p-1 rounded-md bg-orange-50 dark:bg-orange-950/60 text-orange-600 text-sm">
                🔥
              </span>
            </div>
            <div className="text-2xl font-black text-orange-600 dark:text-orange-400">
              {user?.streak ?? 0} ngày
            </div>
            <p className="text-[11px] text-slate-400 mt-1">Duy trì làm khảo sát hàng ngày</p>
          </div>
        </div>

        {/* Recommended Surveys Section */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Khảo Sát Gợi Ý Cho Bạn
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Lựa chọn từ Chợ khảo sát phù hợp với nhân khẩu học của bạn
              </p>
            </div>
            <Link
              href="/marketplace"
              className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
            >
              <span>Xem tất cả</span>
              <span>&rarr;</span>
            </Link>
          </div>

          {!isOnboarded ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-amber-300 dark:border-amber-900/60">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center mx-auto mb-3 text-xl" aria-hidden="true">
                🔒
              </div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">
                Chợ khảo sát đang bị khóa
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto mb-4 leading-relaxed">
                Hoàn thành khảo sát nhân khẩu học bắt buộc để mở Chợ khảo sát và bắt đầu tích lũy điểm thưởng.
              </p>
              <Link
                href="/onboarding"
                className="inline-block px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              >
                Làm khảo sát nhân khẩu học &rarr;
              </Link>
            </div>
          ) : recommendedSurveys.length === 0 ? (
            <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 text-slate-400">
              <p className="text-xs">Hiện không có khảo sát chưa hoàn thành nào.</p>
            </div>
          ) : (
            <>
            {startError && (
              <div
                role="alert"
                className="mb-4 p-3 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300"
              >
                {startError}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {recommendedSurveys.map((survey) => (
                <div
                  key={survey.id}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-xs flex flex-col justify-between hover:border-emerald-400 dark:hover:border-emerald-600 transition-colors"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          survey.type === "INTERNAL"
                            ? "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                            : "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                        }`}
                      >
                        {survey.type === "INTERNAL" ? "RESCOM Nội bộ" : "Google Forms"}
                      </span>
                      <span className="font-extrabold text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2 py-0.5 rounded-full">
                        +{survey.rewardPerResponse} pts
                      </span>
                    </div>

                    <h3 className="text-xs font-bold text-slate-900 dark:text-white line-clamp-1 mb-1">
                      {survey.title}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 mb-4 h-8">
                      {survey.description || "Khảo sát nghiên cứu sinh viên"}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">
                      ~{Math.max(1, Math.round(survey.estimatedEffortSeconds / 60))} phút
                    </span>
                    <button
                      type="button"
                      onClick={() => handleStartSurvey(survey)}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition-colors cursor-pointer"
                    >
                      Bắt đầu &rarr;
                    </button>
                  </div>
                </div>
              ))}
            </div>
            </>
          )}
        </div>
      </div>
    </PortalShell>
  );
}
