"use client";

import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { MarkAllReadButton, NotificationFilters, NotificationList } from "@/components/layout/app/NotificationFeed";
import { NOTIFICATION_MESSAGES } from "@/lib/notifications/notification-messages";
import { useNotificationFeed } from "@/lib/notifications/use-notification-feed";

const PAGE_SIZE = 20;

/**
 * Figma 14d "Trung tâm thông báo" (62:2117, mobile). Desktop is ASSUMED: the
 * header panel's content (62:1862) as a 640px card under the app header.
 */
export function NotificationsScreen() {
  const feed = useNotificationFeed({ pageSize: PAGE_SIZE });

  return (
    <>
      <MobileBackBar title="Thông báo" action={<MarkAllReadButton feed={feed} />} />
      <div className="lg:mx-auto lg:w-full lg:max-w-[640px] lg:py-10">
        <div className="bg-surface lg:overflow-hidden lg:rounded-[20px] lg:border lg:border-line">
          <div className="hidden items-center justify-between gap-3 px-4 pt-4 lg:flex">
            <h1 className="text-title-sm font-extrabold text-ink">Thông báo</h1>
            <MarkAllReadButton feed={feed} />
          </div>
          <div className="border-b border-line px-4 pt-3 pb-3 lg:pb-[13px]">
            <NotificationFilters feed={feed} />
          </div>
          <NotificationList feed={feed} paged />
          <p className="px-5 pt-3.5 pb-6 text-[12px] leading-[18px] text-ink-muted">{NOTIFICATION_MESSAGES.emailNote}</p>
        </div>
      </div>
    </>
  );
}
