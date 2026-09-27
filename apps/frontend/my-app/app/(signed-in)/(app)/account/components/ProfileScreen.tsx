"use client";

import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { Icon } from "@/components/ui/Icon";
import { ACCOUNT_MESSAGES } from "@/lib/profile/account-messages";
import { profileFieldGroups } from "@/lib/profile/account-view";
import { useAccountData } from "../hooks/use-account-data";
import { AccountDesktop } from "./AccountDesktop";
import { ProfileFieldList, ProfileFieldsState } from "./AccountParts";

/**
 * Figma 15h "Hồ sơ (sửa từng mục)" mobile (63:2469). Desktop has no frame of
 * its own: it is the 15g desktop layout (ASSUMED), whose main column is this
 * same profile.
 */
export function ProfileScreen() {
  const data = useAccountData();
  const { answers, demographics, currentYear } = data;

  return (
    <>
      <MobileBackBar title="Hồ sơ của bạn" backHref="/account" />
      <div className="mx-auto w-full max-w-120 px-4 pt-4 pb-8 lg:hidden">
        <p className="flex items-start gap-2.5 rounded-control bg-tone-green-bg px-3.5 py-3 text-caption-relaxed text-ink">
          <Icon name="info" size={18} className="mt-px text-tone-green-fg" />
          <span>{ACCOUNT_MESSAGES.profileNote}</span>
        </p>
        {answers ? (
          <ProfileFieldList groups={profileFieldGroups(answers, currentYear)} />
        ) : (
          <div className="mt-4">
            <ProfileFieldsState error={Boolean(demographics.error)} onRetry={demographics.reload} />
          </div>
        )}
      </div>
      <AccountDesktop data={data} />
    </>
  );
}
