"use client";

import type { ReactNode } from "react";
import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { IconLink } from "@/components/ui/IconButton";

interface TopUpFrameProps {
  /** Mobile back-bar title ("Nạp điểm", "Chuyển khoản", "Yêu cầu nạp điểm"). */
  mobileTitle: string;
  /** Back (mobile) / close (desktop) target. */
  exitHref: string;
  /** Desktop dialog width in px (Figma 14b 720, 14c 600). */
  width: 600 | 720;
  /** Desktop dialog header (title, subtitle, status pill); hidden on mobile. */
  desktopHeader: ReactNode;
  /** Mobile sticky bottom bar (Figma 62:2835: white, top border, 52px CTA). */
  mobileFooter?: ReactNode;
  children: ReactNode;
}

/**
 * Top-up steps (Figma 14). Mobile: back header, content, sticky CTA bar.
 * Desktop 14b/14c are drawn as a dialog card over a #596078 backdrop; the
 * flow renders that card centered on the same flat backdrop as a page
 * (ASSUMED: no wallet page underneath).
 */
export function TopUpFrame({ mobileTitle, exitHref, width, desktopHeader, mobileFooter, children }: TopUpFrameProps) {
  return (
    <>
      <MobileBackBar title={mobileTitle} backHref={exitHref} />
      <div className="flex flex-1 flex-col lg:items-center lg:justify-center lg:bg-ink-muted lg:px-6 lg:py-10">
        <section
          aria-labelledby="top-up-dialog-title"
          className={`flex w-full flex-1 flex-col lg:flex-none lg:rounded-card lg:bg-surface lg:px-8 lg:pt-7 lg:pb-7 lg:shadow-[0_24px_24px_rgba(30,36,70,0.25)] ${
            width === 720 ? "lg:max-w-[720px]" : "lg:max-w-[600px]"
          }`}
        >
          <div className="hidden items-start gap-4 lg:flex">
            <div className="min-w-0 flex-1">{desktopHeader}</div>
            <IconLink href={exitHref} icon="x" label="Đóng" />
          </div>
          <div className="flex flex-1 flex-col px-5 pt-5 pb-6 lg:p-0">{children}</div>
          {mobileFooter ? (
            <div className="sticky bottom-0 border-t border-line bg-surface px-5 pt-3 pb-[max(env(safe-area-inset-bottom),20px)] lg:hidden">
              {mobileFooter}
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
