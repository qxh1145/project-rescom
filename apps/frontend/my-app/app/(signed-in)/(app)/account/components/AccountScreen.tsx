"use client";

import { useState } from "react";
import { MobileTitleBar } from "@/components/layout/app/MobileTopBar";
import { Alert } from "@/components/ui/Alert";
import { PILOT_BUILD } from "@/lib/pilot-scope";
import { SUPPORT_MAILTO } from "@/lib/feedback/error-pages";
import {
  consentLabel,
  personalSummary,
  RELIABILITY_LEVEL_LABEL,
  studySummary,
  unreadLabel,
  weeklyRankLabel,
} from "@/lib/profile/account-view";
import { useAccountData } from "../hooks/use-account-data";
import { useLogout } from "@/lib/auth/use-logout";
import { AccountDesktop } from "./AccountDesktop";
import { GoogleLinkDialog } from "./GoogleLinkDialog";
import { MenuList, MenuRow, SectionLabel } from "./AccountParts";
import { ProfileCard } from "./ProfileCard";

/**
 * Figma 15g "Tài khoản" — mobile 63:1426 (card + settings list), desktop
 * 63:483 (`AccountDesktop`). Rows without a drawn destination (ASSUMED):
 * Google → password confirmation + VERIFIED link/start (`GoogleLinkDialog`),
 * Mật khẩu → 15 "Quên mật khẩu", Thiết bị and Dữ liệu chất lượng are
 * information only, Trợ giúp → support email.
 */
export function AccountScreen() {
  const data = useAccountData({ withRowDetails: true });
  const { answers, currentYear, session, engagement, consent, reliability } = data;
  const { signOut, pending, error, dismissError } = useLogout();
  const [googleOpen, setGoogleOpen] = useState(false);

  return (
    <>
      <MobileTitleBar title="Tài khoản" />
      <div className="mx-auto w-full max-w-120 px-4 pt-4 pb-8 lg:hidden">
        <ProfileCard data={data} />

        <SectionLabel id="account-profile">Hồ sơ</SectionLabel>
        <MenuList labelledBy="account-profile">
          <MenuRow
            icon="user"
            label="Thông tin cá nhân"
            value={answers ? personalSummary(answers, currentYear) : null}
            href="/account/profile"
          />
          <MenuRow
            icon="rows"
            label="Học tập & sở thích"
            value={answers ? studySummary(answers, currentYear) : null}
            href="/account/profile#hoc-tap"
          />
        </MenuList>

        <SectionLabel id="account-security">Đăng nhập &amp; bảo mật</SectionLabel>
        <MenuList labelledBy="account-security">
          <MenuRow icon="key" label="Google" value="Liên kết" onClick={() => setGoogleOpen(true)} />
          <MenuRow icon="padlock" label="Mật khẩu" value="Đổi mật khẩu" href="/forgot-password" />
          <MenuRow icon="smartphone" label="Thiết bị đăng nhập" value="Chỉ 1 thiết bị" />
        </MenuList>

        <SectionLabel id="account-data">Thông báo &amp; dữ liệu</SectionLabel>
        <MenuList labelledBy="account-data">
          <MenuRow icon="bell" label="Thông báo" value={unreadLabel(session.unreadCount)} href="/notifications" />
          <MenuRow
            icon="shield-check"
            label="Dữ liệu chất lượng"
            value={consent.data ? consentLabel(consent.data) : null}
          />
          {PILOT_BUILD ? null : (
            <MenuRow
              icon="refresh"
              label="Độ tin cậy câu trả lời"
              value={reliability.data ? RELIABILITY_LEVEL_LABEL[reliability.data.level] : null}
              href="/account/trust"
            />
          )}
        </MenuList>

        <SectionLabel id="account-other">Khác</SectionLabel>
        <MenuList labelledBy="account-other">
          {PILOT_BUILD ? null : (
            <MenuRow
              icon="flag"
              label="Bảng xếp hạng"
              value={engagement.data ? weeklyRankLabel(engagement.data.weeklyRank) : null}
              href="/leaderboard"
            />
          )}
          <MenuRow icon="help-circle" label="Trợ giúp & hỗ trợ" href={SUPPORT_MAILTO} />
          <MenuRow icon="log-out" label="Đăng xuất" onClick={() => void signOut()} danger busy={pending} />
        </MenuList>
        {error ? (
          <Alert tone="danger" onDismiss={dismissError} className="mt-3">
            {error}
          </Alert>
        ) : null}
        <GoogleLinkDialog open={googleOpen} onClose={() => setGoogleOpen(false)} />
      </div>
      <AccountDesktop data={data} />
    </>
  );
}
