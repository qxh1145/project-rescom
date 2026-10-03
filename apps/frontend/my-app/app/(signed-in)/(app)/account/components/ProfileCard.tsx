"use client";

import Link from "next/link";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { Avatar, initialsOf } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { DemoDataTag } from "@/components/ui/DemoDataTag";
import { Icon } from "@/components/ui/Icon";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ACCOUNT_MESSAGES } from "@/lib/profile/account-messages";
import { tierCardView } from "@/lib/profile/account-view";
import type { AccountData } from "../hooks/use-account-data";

function StatSkeleton() {
  return <div aria-hidden className="h-15.5 animate-pulse rounded-field bg-surface-muted" />;
}

/**
 * Figma "Frame" 63:1433 (mobile) / 63:579 (desktop): avatar, name, email,
 * tier pill, 3 stats and "Cấp tiếp theo" progress. Stats come from the
 * ASSUMED `GET /engagement/me`.
 */
export function ProfileCard({ data }: { data: AccountData }) {
  const { session, engagement } = data;
  const view = engagement.data ? tierCardView(engagement.data) : null;

  return (
    <section
      aria-label="Hồ sơ của bạn"
      className="rounded-[20px] border border-line bg-surface px-4 pt-4 pb-4.5 lg:px-5.5 lg:pt-5.5"
    >
      <div className="flex items-start gap-3.5">
        <Avatar initials={initialsOf(session.displayName || "?")} size={60} className="mt-1.5" />
        <div className="flex min-w-0 flex-col items-start">
          <p className="max-w-full truncate text-[19px] font-extrabold text-ink">{session.displayName}</p>
          <p className="mt-1 max-w-full truncate text-caption text-ink-muted">{session.user?.email}</p>
          {view && !PILOT_BUILD ? (
            <Link
              href="/account/tier"
              className="mt-1 inline-flex h-6 items-center gap-1 rounded-field bg-tone-green-bg px-2.25 text-[12px] font-bold text-tone-green-fg hover:brightness-95"
            >
              <Icon name="check" size={12} />
              {view.tierName}
            </Link>
          ) : null}
          {PILOT_BUILD ? null : <DemoDataTag className="mt-1.5" />}
        </div>
      </div>

      {PILOT_BUILD ? null : engagement.error && !view ? (
        <p className="mt-5 flex flex-wrap items-center gap-x-2 text-caption text-ink-muted" role="alert">
          {ACCOUNT_MESSAGES.engagementLoadFailed}
          <Button variant="ghost" size="sm" className="-my-2" onClick={engagement.reload}>
            Thử lại
          </Button>
        </p>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-3 gap-2">
            {view ? (
              <>
                <Link
                  href="/account/streak"
                  className="flex h-15.5 flex-col rounded-field bg-tone-amber-bg px-2.5 pt-2.5 hover:brightness-95"
                >
                  <span className="flex items-center gap-1 text-[12px] font-semibold text-tone-amber-fg">
                    <Icon name="flame" size={14} />
                    Chuỗi
                  </span>
                  <span className="mt-0.5 text-[20px] font-extrabold text-ink">{view.streakDays} ngày</span>
                </Link>
                <div className="flex h-15.5 flex-col rounded-field bg-surface-muted px-2.5 pt-2.5">
                  <span className="text-[12px] font-semibold text-ink-muted">Đã làm</span>
                  <span className="mt-0.5 text-[20px] font-extrabold text-ink">{view.completed}</span>
                </div>
                <div className="flex h-15.5 flex-col rounded-field bg-surface-muted px-2.5 pt-2.5">
                  <span className="text-[12px] font-semibold text-ink-muted">Đã đăng</span>
                  <span className="mt-0.5 text-[20px] font-extrabold text-ink">{view.published}</span>
                </div>
              </>
            ) : (
              <>
                <StatSkeleton />
                <StatSkeleton />
                <StatSkeleton />
              </>
            )}
          </div>

          {view?.next ? (
            <div className="mt-3.5">
              <div className="flex items-baseline justify-between gap-3 text-caption">
                <p className="min-w-0 text-ink-muted">
                  Cấp tiếp theo: <strong className="font-bold text-ink">{view.next.name}</strong>
                </p>
                <p className="shrink-0 font-bold text-ink">
                  {view.next.current}/{view.next.target}
                </p>
              </div>
              <ProgressBar
                value={view.next.current}
                max={view.next.target}
                height={8}
                className="mt-1.5"
                label={`Tiến độ lên hạng ${view.next.name}`}
              />
              <p className="mt-1.5 text-[12px] text-ink-muted">
                {view.next.hint}{" "}
                <Link href="/account/tier" className="font-bold text-primary hover:underline">
                  Xem các hạng
                </Link>
              </p>
            </div>
          ) : view ? (
            <p className="mt-3.5 text-[12px] text-ink-muted">
              Bạn đang ở hạng cao nhất.{" "}
              <Link href="/account/tier" className="font-bold text-primary hover:underline">
                Xem các hạng
              </Link>
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
