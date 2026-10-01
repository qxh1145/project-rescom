"use client";

import Link from "next/link";
import { DemoDataTag } from "@/components/ui/DemoDataTag";
import { useState } from "react";
import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { buttonClassName } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { useApiQuery } from "@/lib/api/use-api-query";
import { ENGAGEMENT_MESSAGES } from "@/lib/engagement/engagement-messages";
import { getEngagementSummary, type EngagementSummary } from "@/lib/engagement/engagement-service";
import {
  formatDays,
  streakTodayKey,
  nextStreakHint,
  streakStatusLine,
  weekDays,
  type StreakDayState,
} from "@/lib/engagement/streak-view";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";
import { ErrorStatus, LoadingStatus } from "../../../_engagement/QueryStatus";

const DAY_DISC: Record<StreakDayState, string> = {
  done: "bg-rating text-ink",
  missed: "bg-line-subtle",
  // ASSUMED (not drawn): today, not counted yet.
  today: "border-2 border-rating bg-surface",
  upcoming: "border-2 border-dashed border-line-strong",
};

const DAY_STATUS: Record<StreakDayState, string> = {
  done: "đã tính",
  missed: "không làm khảo sát",
  today: "hôm nay, chưa tính",
  upcoming: "chưa tới",
};

function WeekRow({ summary, today }: { summary: EngagementSummary; today: string }) {
  return (
    <section aria-labelledby="streak-week-title" className="rounded-[20px] border border-line bg-surface px-4 pt-[17px] pb-[17px]">
      <h2 id="streak-week-title" className="text-body font-extrabold text-ink">
        Tuần này
      </h2>
      <ol className="mt-3.5 grid grid-cols-7">
        {weekDays(summary.streak.week, today).map((day) => (
          <li key={day.date} className="flex flex-col items-center gap-1.5">
            <span className={`flex size-9.5 items-center justify-center rounded-full ${DAY_DISC[day.state]}`}>
              {day.state === "done" ? <Icon name="flame" size={20} /> : null}
            </span>
            <span className={`text-[12px] font-bold ${day.isToday ? "text-ink" : "text-ink-muted"}`}>
              {day.label}
              <span className="sr-only">: {DAY_STATUS[day.state]}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Figma 16a "Chuỗi ngày" (63:4629, mobile). Desktop is derived (ASSUMED): the
 * same cards in a 720px column under the app header, CTA inline instead of a
 * bottom bar.
 */
export function StreakScreen() {
  const query = useApiQuery("engagement-summary", getEngagementSummary);
  const summary = query.data;
  // 401 / locked account: SessionGate redirects; keep the loading state meanwhile.
  const sessionLost = useSessionLossRedirect(query.error);
  // The streak day is the Vietnamese calendar day.
  const [today] = useState(() => streakTodayKey(new Date()));

  return (
    <>
      <MobileBackBar title="Chuỗi ngày" backHref="/account" />
      <div className="mx-auto flex w-full max-w-[720px] flex-col px-4 pt-5 pb-[140px] lg:px-0 lg:pt-10 lg:pb-12">
        <h1 className="mb-6 hidden text-title font-extrabold text-ink lg:block">Chuỗi ngày</h1>
        <DemoDataTag className="mb-4 self-start" />

        {query.error && !summary && !sessionLost ? (
          <ErrorStatus message={ENGAGEMENT_MESSAGES.summaryLoadFailed} onRetry={query.reload} />
        ) : !summary ? (
          <LoadingStatus />
        ) : (
          <div className="flex flex-col gap-4">
            <section className="flex h-[186px] flex-col items-center rounded-[22px] bg-tone-amber-bg px-4 pt-6 text-center">
              <span className="flex size-16 items-center justify-center rounded-full bg-rating text-ink">
                <Icon name="flame" size={34} />
              </span>
              <p className="mt-[5px] text-[40px] font-extrabold leading-[44px] text-ink">
                <span className="sr-only">Chuỗi hiện tại: </span>
                {formatDays(summary.streak.current)}
              </p>
              <p className="mt-1.5 text-body-sm leading-normal text-tone-amber-ink">{streakStatusLine(summary.streak)}</p>
            </section>

            <WeekRow summary={summary} today={today} />

            <section className="rounded-[20px] border border-line bg-surface px-[17px] pt-[17px] pb-5">
              <h2 className="text-body-relaxed font-extrabold text-ink">Cách tính chuỗi</h2>
              <p className="mt-2 text-body-sm leading-[21.7px] text-ink-strong">
                Mỗi ngày làm xong ít nhất 1 khảo sát, chuỗi tăng thêm 1. Làm nhiều khảo sát trong một ngày vẫn chỉ tính 1
                ngày.
              </p>
              <p className="mt-2.5 text-body-sm leading-[21.7px] text-ink-strong">Bỏ lỡ một ngày, chuỗi quay về 0.</p>
            </section>

            <Link
              href="/leaderboard?type=streak"
              className="flex h-[50px] items-center gap-3 rounded-2xl border border-line bg-surface px-[15px] transition-colors hover:bg-surface-subtle"
            >
              <Icon name="flag" size={20} className="text-ink-muted" />
              <span className="min-w-0 flex-1 truncate text-body font-bold text-ink">Xem bảng xếp hạng chuỗi dài nhất</span>
              <Icon name="chevron-right" size={18} className="text-line-strong" />
            </Link>

            {/* Mobile: bottom bar above the tab bar (Figma 63:4670). Desktop: inline (ASSUMED). */}
            <div className="fixed inset-x-0 bottom-[calc(62px+env(safe-area-inset-bottom))] z-20 border-t border-line bg-surface px-4 pt-[11px] pb-4 lg:static lg:mt-2 lg:border-0 lg:bg-transparent lg:p-0">
              <p className="text-center text-caption text-ink-muted">{nextStreakHint(summary.streak, today)}</p>
              <Link
                href="/marketplace"
                className={buttonClassName({ size: "lg", radius: "field", fullWidth: true, className: "mt-2" })}
              >
                Tìm khảo sát
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
