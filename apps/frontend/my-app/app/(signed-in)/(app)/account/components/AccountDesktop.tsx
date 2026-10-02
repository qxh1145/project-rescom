"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useProductTour } from "@/components/product-tour/TourProvider";
import { Alert } from "@/components/ui/Alert";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { Icon } from "@/components/ui/Icon";
import { Spinner } from "@/components/ui/Spinner";
import { SUPPORT_MAILTO } from "@/lib/feedback/error-pages";
import { ACCOUNT_MESSAGES } from "@/lib/profile/account-messages";
import { profileFieldGroups } from "@/lib/profile/account-view";
import type { AccountData } from "../hooks/use-account-data";
import { useLogout } from "@/lib/auth/use-logout";
import { ProfileFieldGrid, ProfileFieldsState } from "./AccountParts";
import { GoogleLinkDialog } from "./GoogleLinkDialog";
import { ProfileCard } from "./ProfileCard";

const NAV_ITEM =
  "flex h-11 w-full items-center gap-2.5 rounded-[10px] px-3 text-body transition-colors hover:bg-surface-subtle";

function NavLink({ href, icon, children, active = false }: { href: string; icon: string; children: ReactNode; active?: boolean }) {
  const className = `${NAV_ITEM} ${active ? "bg-tone-green-bg font-bold text-tone-green-fg hover:bg-tone-green-bg" : "font-semibold text-ink"}`;
  const content = (
    <>
      <Icon name={icon} size={20} />
      {children}
    </>
  );
  return (
    <li>
      {href.startsWith("mailto:") || href.startsWith("#") ? (
        <a href={href} className={className}>
          {content}
        </a>
      ) : (
        <Link href={href} aria-current={active ? "page" : undefined} className={className}>
          {content}
        </Link>
      )}
    </li>
  );
}

/**
 * Sidebar of 63:483. Only "Hồ sơ" has a drawn desktop screen; the other
 * entries open their closest destination (ASSUMED): the login card below,
 * `/notifications`, `/account/trust`, and a support email.
 */
function AccountSidebar() {
  const { signOut, pending, error } = useLogout();
  const tour = useProductTour();
  return (
    <aside>
      <h1 className="text-[24px] font-extrabold text-ink">Tài khoản</h1>
      <nav aria-label="Tài khoản" className="mt-3.5">
        <ul className="flex flex-col gap-1">
          <NavLink href="/account" icon="user" active>
            Hồ sơ
          </NavLink>
          <NavLink href="#dang-nhap" icon="key">
            Đăng nhập &amp; bảo mật
          </NavLink>
          <NavLink href="/notifications" icon="bell">
            Thông báo
          </NavLink>
          {PILOT_BUILD ? null : (
            <NavLink href="/account/trust" icon="shield-check">
              Dữ liệu &amp; quyền riêng tư
            </NavLink>
          )}
          <NavLink href={SUPPORT_MAILTO} icon="help-circle">
            Trợ giúp
          </NavLink>
          {/* Tours are desktop-only, and the floating launcher hides once every tour is done.
              Opens the hub, where each tour can be replayed ("Xem lại"). */}
          {tour.enabled ? (
            <li>
              <button
                type="button"
                onClick={tour.openHub}
                aria-haspopup="dialog"
                className={`${NAV_ITEM} font-semibold text-ink`}
              >
                <Icon name="play-circle" size={20} />
                Xem lại hướng dẫn
              </button>
            </li>
          ) : null}
        </ul>
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={pending}
          aria-busy={pending || undefined}
          className={`${NAV_ITEM} mt-3 font-semibold text-danger hover:bg-danger-soft disabled:opacity-60`}
        >
          {pending ? <Spinner className="size-5" /> : <Icon name="log-out" size={20} />}
          Đăng xuất
        </button>
      </nav>
      {error ? (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      ) : null}
    </aside>
  );
}

/** "Đăng nhập" card (63:604). */
function LoginCard({ email }: { email: string }) {
  const [googleOpen, setGoogleOpen] = useState(false);
  return (
    <section
      id="dang-nhap"
      aria-labelledby="dang-nhap-title"
      className="scroll-mt-24 rounded-[20px] border border-line bg-surface px-5 pt-4 pb-5"
    >
      <h2 id="dang-nhap-title" className="text-body font-extrabold text-ink">
        Đăng nhập
      </h2>
      <div className="mt-2 flex items-center gap-2.5">
        <span
          aria-hidden
          className="inline-flex size-6.5 shrink-0 items-center justify-center rounded-full border border-line text-label font-extrabold text-primary"
        >
          G
        </span>
        <p className="min-w-0 flex-1 truncate text-label text-ink">Google · {email}</p>
        {/* ASSUMED: `GET /auth/me` does not say whether Google is linked; an already linked
            account gets AUTH_GOOGLE_IDENTITY_CONFLICT in the dialog. */}
        <button
          type="button"
          onClick={() => setGoogleOpen(true)}
          className="shrink-0 text-caption font-bold text-tone-teal-fg hover:underline"
        >
          Liên kết
        </button>
      </div>
      <div className="mt-2.5 flex items-center gap-2.5">
        <Icon name="padlock" size={20} className="text-ink-muted" />
        <p className="min-w-0 flex-1 text-label text-ink-strong">Mật khẩu</p>
        <Link href="/forgot-password" className="shrink-0 text-caption font-bold text-primary hover:underline">
          Đổi mật khẩu
        </Link>
      </div>
      <div className="mt-2.5 flex items-center gap-2.5">
        <Icon name="smartphone" size={20} className="text-ink-muted" />
        <p className="text-label text-ink-strong">Chỉ đăng nhập trên 1 thiết bị cùng lúc</p>
      </div>
      <GoogleLinkDialog open={googleOpen} onClose={() => setGoogleOpen(false)} />
    </section>
  );
}

/**
 * Figma 15g "Tài khoản & hồ sơ" desktop (63:483): sidebar, "Hồ sơ nhân khẩu"
 * and the profile/login cards. Shared by `/account` and `/account/profile`
 * (the mobile 15h screen has no desktop frame of its own).
 */
export function AccountDesktop({ data }: { data: AccountData }) {
  const { answers, demographics, currentYear, session } = data;
  return (
    <div className="mx-auto hidden w-full max-w-[1440px] grid-cols-[240px_minmax(0,1fr)_380px] gap-x-6 px-12 pt-8 pb-12 lg:grid">
      <div className="mr-2">
        <AccountSidebar />
      </div>
      <section
        aria-labelledby="ho-so-nhan-khau"
        className="self-start rounded-[22px] border border-line bg-surface px-7 pt-6 pb-6.5"
      >
        <h2 id="ho-so-nhan-khau" className="text-[19px] font-extrabold text-ink">
          Hồ sơ nhân khẩu
        </h2>
        <p className="mt-1 text-label font-normal text-ink-muted">{ACCOUNT_MESSAGES.desktopProfileNote}</p>
        {answers ? (
          <ProfileFieldGrid groups={profileFieldGroups(answers, currentYear)} />
        ) : (
          <div className="mt-5">
            <ProfileFieldsState error={Boolean(demographics.error)} onRetry={demographics.reload} />
          </div>
        )}
      </section>
      <div className="flex flex-col gap-4 self-start">
        <ProfileCard data={data} />
        <LoginCard email={session.user?.email ?? ""} />
      </div>
    </div>
  );
}
