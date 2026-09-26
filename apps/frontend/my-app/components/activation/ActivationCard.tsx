"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  STARTER_POINTS_DEFAULT_AMOUNT,
  type MarketplaceSurveyCardDto,
  type StarterActivationState,
  type StarterPointsStatusDto,
} from "@rescom/schemas";
import { mockRepository, NOTIFICATIONS_CHANGED_EVENT } from "@/lib/mock/repository.ts";
import {
  activationDismissKey,
  activationProgressPercent,
  attemptPath,
  formatVnDate,
  formatVnDateTime,
  isActivationWindowOpen,
  isExpiryUrgent,
  isRecentActivation,
  readActivationDismissed,
  writeActivationDismissed,
} from "@/lib/activation.ts";
import {
  buildOnboardingRedirect,
  isDemographicProfileRequiredError,
} from "@/lib/onboarding.ts";

interface ActivationCardProps {
  /** Where the card is rendered; the Marketplace is the activation step itself. */
  variant: "marketplace" | "dashboard";
  /** Story 7.1 handoff (`/marketplace?activation=1`) right after the demographic survey. */
  highlightHandoff?: boolean;
  /** Lets the page reflect the live activation state (e.g. the "Verified Member" badge). */
  onStatusChange?: (status: StarterPointsStatusDto) => void;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      status: StarterPointsStatusDto;
      recommendedSurveys: MarketplaceSurveyCardDto[];
      dismissed: boolean;
    };

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600";

/**
 * Marketplace activation step (Story 7.2, FR-7/FR-8): after the Mandatory
 * Demographic Survey, prompts the respondent to complete one eligible
 * Marketplace survey to unlock the 100 Frozen starter points, then shows a
 * one-time success state. All rules come from the repository.
 */
export function ActivationCard({
  variant,
  highlightHandoff = false,
  onStatusChange,
}: ActivationCardProps) {
  const router = useRouter();
  const headingId = useId();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const onStatusChangeRef = useRef(onStatusChange);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const result = await mockRepository.getActivationStatus();
        if (!active) return;
        const { status } = result;
        const dismissKind =
          status.activationState === "ACTIVATED"
            ? "success"
            : status.activationState === "EXPIRED"
              ? "expired"
              : null;
        setState({
          kind: "ready",
          status,
          recommendedSurveys: result.recommendedSurveys,
          dismissed: dismissKind
            ? readActivationDismissed(activationDismissKey(status.userId, dismissKind))
            : false,
        });
        onStatusChangeRef.current?.(status);
      } catch (error) {
        if (!active) return;
        setState({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Không tải được tiến độ kích hoạt tài khoản.",
        });
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [reloadKey]);

  // Another tab/page may unlock (e.g. a matured External survey): refresh.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => setReloadKey((key) => key + 1);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
  }, []);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setReloadKey((key) => key + 1);
  }, []);

  function dismiss(kind: "success" | "expired") {
    if (state.kind !== "ready") return;
    writeActivationDismissed(activationDismissKey(state.status.userId, kind));
    setState({ ...state, dismissed: true });
  }

  async function startSurvey(survey: MarketplaceSurveyCardDto) {
    setStartingId(survey.id);
    setStartError(null);
    try {
      const attempt = await mockRepository.startSurveyAttempt(survey.id);
      if (survey.type === "EXTERNAL" && attempt.externalUrl) {
        window.open(attempt.externalUrl, "_blank", "noopener,noreferrer");
      }
      router.push(attemptPath(survey, attempt));
    } catch (error) {
      if (isDemographicProfileRequiredError(error)) {
        router.replace(buildOnboardingRedirect(variant === "dashboard" ? "/dashboard" : "/marketplace"));
        return;
      }
      setStartError(
        error instanceof Error
          ? error.message
          : "Không thể bắt đầu khảo sát. Vui lòng thử lại.",
      );
      setStartingId(null);
    }
  }

  if (state.kind === "loading") {
    return (
      <div
        role="status"
        className="mb-6 p-5 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 animate-pulse motion-reduce:animate-none"
      >
        <span className="sr-only">Đang tải tiến độ kích hoạt tài khoản...</span>
        <div className="h-3 w-40 rounded bg-slate-200 dark:bg-slate-800 mb-3" />
        <div className="h-2 w-full rounded bg-slate-100 dark:bg-slate-800" />
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div
        role="alert"
        className="mb-6 p-4 rounded-3xl bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900 text-xs flex flex-wrap items-center justify-between gap-3"
      >
        <span>Không tải được tiến độ kích hoạt: {state.message}</span>
        <button
          type="button"
          onClick={retry}
          className={`px-3 py-1.5 bg-rose-600 text-white font-bold rounded-lg hover:bg-rose-700 transition-colors cursor-pointer ${focusRing}`}
        >
          Thử lại
        </button>
      </div>
    );
  }

  const { status, recommendedSurveys, dismissed } = state;
  const activationState: StarterActivationState = status.activationState;
  const amount = STARTER_POINTS_DEFAULT_AMOUNT;

  if (activationState === "NOT_GRANTED") {
    return null;
  }

  if (activationState === "ACTIVATED") {
    if (dismissed || !isRecentActivation(status.activatedAt)) return null;
    return (
      <section
        role="status"
        aria-labelledby={headingId}
        className="mb-6 p-5 rounded-3xl bg-gradient-to-r from-emerald-50 to-amber-50 dark:from-emerald-950/40 dark:to-amber-950/30 border border-emerald-200 dark:border-emerald-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div className="flex items-start gap-3">
          <span className="text-2xl" aria-hidden="true">🎉</span>
          <div>
            <h2 id={headingId} className="text-sm font-black text-emerald-900 dark:text-emerald-200">
              Tài khoản đã được kích hoạt — +{amount} điểm Khả dụng
            </h2>
            <p className="text-xs text-emerald-800 dark:text-emerald-300 mt-1 leading-relaxed">
              Bạn đã hoàn thành 2 bước kích hoạt và trở thành <strong>Thành viên Đã Xác Thực</strong>.{" "}
              {amount} điểm tân thủ đã chuyển từ Khóa (Frozen) sang Khả dụng và có thể dùng để đăng khảo sát.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link
            href="/wallet"
            className={`px-3.5 py-2 text-xs font-bold rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 transition-colors ${focusRing}`}
          >
            Xem Ví điểm
          </Link>
          <button
            type="button"
            onClick={() => dismiss("success")}
            className={`px-3.5 py-2 text-xs font-semibold rounded-xl border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors cursor-pointer ${focusRing}`}
          >
            Đóng
          </button>
        </div>
      </section>
    );
  }

  if (activationState === "EXPIRED") {
    if (dismissed) return null;
    return (
      <section
        aria-labelledby={headingId}
        className="mb-6 p-5 rounded-3xl bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div className="flex items-start gap-3">
          <span className="text-2xl" aria-hidden="true">⌛</span>
          <div>
            <h2 id={headingId} className="text-sm font-bold text-slate-900 dark:text-white">
              Điểm tân thủ đã hết hạn
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
              Tài khoản chưa hoàn tất kích hoạt trong 30 ngày kể từ khi đăng ký (hạn {formatVnDate(status.expiresAt)}), nên {amount} điểm Khóa đã bị thu hồi.
              Bạn vẫn có thể làm khảo sát để tích lũy điểm thưởng như bình thường.{" "}
              {/* Decision E7-DN3: expiry forfeits only the points. */}
              {status.isVerifiedMember
                ? "Bạn vẫn là Thành viên Đã Xác Thực."
                : "Hoàn thành 1 khảo sát do người khác đăng để trở thành Thành viên Đã Xác Thực."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => dismiss("expired")}
          className={`px-3.5 py-2 text-xs font-semibold rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 cursor-pointer ${focusRing}`}
        >
          Đã hiểu
        </button>
      </section>
    );
  }

  if (activationState === "DEMOGRAPHICS_REQUIRED") {
    return (
      <section
        aria-labelledby={headingId}
        className="mb-6 p-5 rounded-3xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div>
          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">
            Bước 1 / 2
          </span>
          <h2 id={headingId} className="text-sm font-bold text-amber-900 dark:text-amber-200 mt-2">
            Hoàn thành khảo sát nhân khẩu học để bắt đầu kích hoạt
          </h2>
          <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
            {amount} điểm tân thủ đang bị Khóa. Còn {status.daysRemaining} ngày (đến {formatVnDate(status.expiresAt)}).
          </p>
        </div>
        <Link
          href="/onboarding"
          className={`px-4 py-2 text-xs font-bold rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shrink-0 ${focusRing}`}
        >
          Làm khảo sát nhân khẩu học &rarr;
        </Link>
      </section>
    );
  }

  // SURVEY_REQUIRED, PENDING_CONFIRMATION or READY_TO_UNLOCK: the activation step.
  const percent = activationProgressPercent(activationState);
  const urgent = isExpiryUrgent(status.daysRemaining);
  const pending =
    activationState === "PENDING_CONFIRMATION" ? status.activationSurvey : null;
  // Code review P7: past the 30-day deadline a new completion never counts
  // (FR-5), so neither the "unlock now" nudge nor recommendations are shown.
  const windowOpen = isActivationWindowOpen(status);

  return (
    <section
      aria-labelledby={headingId}
      className={`mb-6 p-5 sm:p-6 rounded-3xl bg-gradient-to-br from-emerald-50 to-sky-50 dark:from-emerald-950/40 dark:to-sky-950/30 border ${
        highlightHandoff
          ? "border-emerald-400 dark:border-emerald-600 shadow-md shadow-emerald-500/10"
          : "border-emerald-200 dark:border-emerald-900/60"
      }`}
    >
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300">
              Bước 2 / 2 · Kích hoạt tài khoản
            </span>
            {highlightHandoff && (
              <span className="text-[11px] font-bold text-emerald-900 dark:text-emerald-200">
                ✓ Hồ sơ nhân khẩu học đã được lưu!
              </span>
            )}
          </div>
          <h2 id={headingId} className="text-base font-black text-slate-900 dark:text-white mt-2">
            Hoàn thành 1 khảo sát trên Chợ khảo sát để mở khóa {amount} điểm tân thủ
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed max-w-2xl">
            Chỉ tính khảo sát do người khác đăng. Khảo sát nội bộ RESCOM mở khóa ngay khi nộp bài;
            khảo sát Google Forms mở khóa sau 48 giờ đối soát.
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-3 shrink-0 text-center">
          <div className="px-4 py-3 rounded-2xl bg-white/80 dark:bg-slate-900/70 border border-sky-200 dark:border-sky-900">
            <dt className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Điểm đang Khóa</dt>
            <dd className="text-xl font-black text-sky-600 dark:text-sky-400">❄️ {status.frozenBalance}</dd>
          </div>
          <div
            className={`px-4 py-3 rounded-2xl bg-white/80 dark:bg-slate-900/70 border ${
              urgent ? "border-rose-300 dark:border-rose-800" : "border-slate-200 dark:border-slate-800"
            }`}
          >
            <dt className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Thời hạn kích hoạt</dt>
            <dd
              className={`text-xl font-black ${
                urgent ? "text-rose-600 dark:text-rose-400" : "text-slate-800 dark:text-slate-100"
              }`}
            >
              {status.daysRemaining} ngày
            </dd>
            <dd className="text-[10px] text-slate-500 dark:text-slate-400">đến {formatVnDate(status.expiresAt)}</dd>
          </div>
        </dl>
      </div>

      {/* Progress: step 1 (profile) done, step 2 (one survey) in progress */}
      <div className="mt-4">
        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
          <span>✓ Hồ sơ nhân khẩu học</span>
          <span>
            {activationState === "PENDING_CONFIRMATION"
              ? "Khảo sát đang chờ đối soát"
              : activationState === "READY_TO_UNLOCK"
                ? "Đang mở khóa điểm"
                : "Khảo sát đầu tiên: chưa hoàn thành"}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Tiến độ kích hoạt tài khoản"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 rounded-full bg-white dark:bg-slate-800 overflow-hidden border border-emerald-100 dark:border-emerald-900"
        >
          <div
            className="h-full bg-emerald-500 rounded-full transition-all motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {pending && (
        <p
          role="status"
          className="mt-4 p-3 rounded-2xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-900 text-xs text-purple-900 dark:text-purple-200 leading-relaxed"
        >
          ⏳ Đã ghi nhận khảo sát Google Forms của bạn. {amount} điểm tân thủ sẽ được mở khóa khi hết 48 giờ đối soát
          (khoảng <strong>{formatVnDateTime(pending.confirmsAt)}</strong>).{" "}
          {windowOpen
            ? "Muốn mở khóa ngay? Hãy làm 1 khảo sát nội bộ bên dưới."
            : "Thời hạn 30 ngày đã kết thúc, nên chỉ khảo sát đã ghi nhận trong hạn này còn được tính để kích hoạt."}
        </p>
      )}

      {activationState === "READY_TO_UNLOCK" && (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-emerald-900 dark:text-emerald-200">
          <span>Bạn đã đủ điều kiện kích hoạt. Hệ thống đang chuyển {amount} điểm sang Khả dụng.</span>
          <button
            type="button"
            onClick={retry}
            className={`px-3 py-1.5 text-xs font-bold rounded-xl text-white bg-emerald-600 hover:bg-emerald-700 transition-colors cursor-pointer ${focusRing}`}
          >
            Cập nhật trạng thái
          </button>
        </div>
      )}

      {activationState !== "READY_TO_UNLOCK" && windowOpen && (
        <div className="mt-5">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">
              {pending ? "Mở khóa ngay với khảo sát nội bộ" : "Khảo sát gợi ý để kích hoạt"}
            </h3>
            {variant === "dashboard" && (
              <Link
                href="/marketplace?activation=1"
                className={`text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline rounded ${focusRing}`}
              >
                Xem Chợ khảo sát &rarr;
              </Link>
            )}
          </div>

          {startError && (
            <p role="alert" className="mb-2 text-xs text-rose-600 dark:text-rose-400">
              {startError}
            </p>
          )}

          {recommendedSurveys.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Hiện chưa có khảo sát phù hợp để gợi ý. Hãy xem toàn bộ Chợ khảo sát hoặc quay lại sau nhé.
            </p>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {recommendedSurveys.map((survey) => {
                const minutes = Math.max(1, Math.round(survey.estimatedEffortSeconds / 60));
                const isInternal = survey.type === "INTERNAL";
                return (
                  <li
                    key={survey.id}
                    className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            isInternal
                              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                              : "bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
                          }`}
                        >
                          {isInternal ? "Mở khóa ngay" : "Mở khóa sau 48 giờ"}
                        </span>
                        <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400">
                          +{survey.rewardPerResponse} điểm
                        </span>
                      </div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white line-clamp-2">
                        {survey.title}
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {isInternal ? "RESCOM Nội bộ" : "Google Forms"} · ~{minutes} phút
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void startSurvey(survey)}
                      disabled={startingId !== null}
                      aria-label={`Làm khảo sát ${survey.title}`}
                      className={`w-full px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs transition-colors cursor-pointer ${focusRing}`}
                    >
                      {startingId === survey.id ? "Đang mở..." : "Làm ngay →"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
