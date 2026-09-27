"use client";

import { useEffect, useState } from "react";
import {
  describeParticipationGuard,
  describeTimeBarrierRule,
  formatWaitDuration,
  secondsUntil,
  type ParticipationGuard,
} from "@/lib/participation-guards.ts";

export interface TimeBarrierNoticeBarrier {
  requiredSeconds: number;
  questionCount: number | null;
  secondsPerQuestion: number | null;
  earliestSubmitAt: string;
}

interface TimeBarrierNoticeProps {
  barrier: TimeBarrierNoticeBarrier | null;
  /** Last bot-protection rejection returned by the repository/API. */
  guard: ParticipationGuard | null;
}

type Phase = "rate-limited" | "too-fast" | "waiting" | "ready";

function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Story 8.2 (FR-45/FR-46): shows the minimum answering time with a live
 * countdown, the friendly "take your time" state after a too-fast submission
 * and the rate-limit wait. Purely presentational — the repository (server)
 * decides; this only counts down to the times it returned.
 */
export function TimeBarrierNotice({ barrier, guard }: TimeBarrierNoticeProps) {
  const [now, setNow] = useState(() => Date.now());

  const earliestSubmitAt =
    guard?.kind === "TIME_BARRIER"
      ? guard.earliestSubmitAt
      : (barrier?.earliestSubmitAt ?? null);
  const barrierRemaining = earliestSubmitAt ? secondsUntil(earliestSubmitAt, now) : 0;
  const rateLimitRemaining =
    guard?.kind === "RATE_LIMIT" ? secondsUntil(guard.retryAt, now) : 0;
  const counting = barrierRemaining > 0 || rateLimitRemaining > 0;

  useEffect(() => {
    if (!counting) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [counting]);

  if (!barrier && !guard) return null;

  const phase: Phase =
    guard?.kind === "RATE_LIMIT" && rateLimitRemaining > 0
      ? "rate-limited"
      : barrierRemaining > 0
        ? guard?.kind === "TIME_BARRIER"
          ? "too-fast"
          : "waiting"
        : "ready";

  const requiredSeconds =
    guard?.kind === "TIME_BARRIER" ? guard.requiredSeconds : (barrier?.requiredSeconds ?? 0);
  const ruleSource = guard?.kind === "TIME_BARRIER" ? guard : barrier;
  const rule = ruleSource ? describeTimeBarrierRule({ ...ruleSource, requiredSeconds }) : "";
  const progress =
    requiredSeconds > 0
      ? Math.min(100, Math.round(((requiredSeconds - barrierRemaining) / requiredSeconds) * 100))
      : 100;

  // Screen readers hear one message per phase (not every tick).
  const announcement =
    phase === "rate-limited" && guard?.kind === "RATE_LIMIT"
      ? `Tạm dừng nộp bài. Bạn có thể thử lại lúc ${formatClock(guard.retryAt)}.`
      : phase === "too-fast" && earliestSubmitAt
        ? `Bạn đang làm hơi nhanh. Khảo sát cần ít nhất ${requiredSeconds} giây. Có thể nộp lại lúc ${formatClock(earliestSubmitAt)}.`
        : phase === "waiting" && earliestSubmitAt
          ? `Thời gian làm bài tối thiểu ${requiredSeconds} giây. Có thể nộp bài từ ${formatClock(earliestSubmitAt)}.`
          : `Bạn đã đủ thời gian làm bài tối thiểu và có thể nộp bài.`;

  return (
    <div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {phase === "rate-limited" && guard?.kind === "RATE_LIMIT" && (
        <div className="p-4 rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300 text-xs flex items-start gap-2.5">
          <span className="text-base shrink-0" aria-hidden="true">
            🛑
          </span>
          <div>
            <p className="font-bold">Tạm dừng nộp bài</p>
            <p className="mt-0.5 leading-relaxed">
              {describeParticipationGuard(guard, rateLimitRemaining)}
            </p>
            <p className="mt-1 text-[11px] opacity-80">
              Câu trả lời của bạn vẫn được giữ trên trang này.
            </p>
          </div>
        </div>
      )}

      {(phase === "too-fast" || phase === "waiting") && (
        <div
          className={`p-4 rounded-2xl border text-xs ${
            phase === "too-fast"
              ? "border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200"
              : "border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300"
          }`}
        >
          <div className="flex items-start gap-2.5">
            <span className="text-base shrink-0" aria-hidden="true">
              {phase === "too-fast" ? "🐢" : "⏱️"}
            </span>
            <div className="flex-1 min-w-0">
              {phase === "too-fast" && guard?.kind === "TIME_BARRIER" ? (
                <>
                  <p className="font-bold">Hãy dành thời gian đọc kỹ câu hỏi nhé!</p>
                  <p className="mt-0.5 leading-relaxed">
                    {describeParticipationGuard(guard, barrierRemaining)}
                  </p>
                </>
              ) : (
                <p className="leading-relaxed">
                  Thời gian làm bài tối thiểu: <strong>{requiredSeconds} giây</strong> ({rule}).
                  Bạn có thể nộp bài sau{" "}
                  <strong className="tabular-nums">{formatWaitDuration(barrierRemaining)}</strong>{" "}
                  — hãy đọc kỹ từng câu hỏi.
                </p>
              )}
              <div
                className="mt-2 h-1.5 w-full rounded-full bg-black/5 dark:bg-white/10 overflow-hidden"
                aria-hidden="true"
              >
                <div
                  className={`h-full rounded-full transition-all duration-1000 motion-reduce:transition-none ${
                    phase === "too-fast" ? "bg-amber-500" : "bg-indigo-500"
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === "ready" && requiredSeconds > 0 && (
        <p className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
          <span aria-hidden="true">✓</span>
          {guard?.kind === "TIME_BARRIER"
            ? "Đã đủ thời gian tối thiểu — bạn có thể nộp lại ngay bây giờ."
            : `Bạn đã đủ thời gian làm bài tối thiểu (${requiredSeconds} giây). Có thể nộp bài khi sẵn sàng.`}
        </p>
      )}
    </div>
  );
}
