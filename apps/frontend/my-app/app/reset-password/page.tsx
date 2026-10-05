import { Suspense } from "react";
import type { Metadata } from "next";
import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { AuthHero } from "../login/components/AuthHero";
import { AuthSplitLayout } from "../login/components/AuthSplitLayout";
import { ResetPasswordPanel } from "./components/ResetPasswordPanel";

export const metadata: Metadata = {
  title: "Đặt lại mật khẩu — Rescom",
  // The URL carries the one-time reset token: never send it as a Referer.
  referrer: "no-referrer",
};

/** Keeps the panel footprint while the token is read from the URL on the client. */
function ResetPasswordFallback() {
  return <div aria-hidden="true" className="mx-auto h-110 w-full max-w-[440px] lg:max-w-[542px]" />;
}

/**
 * Plan 5.4 `/reset-password?token=…` (the link of the reset email). Not drawn
 * in Figma: same split layout, hero and card as 15b "Quên mật khẩu" (ASSUMED (design)).
 */
export default function ResetPasswordPage() {
  return (
    <AuthSplitLayout
      hero={<AuthHero showSteps={false} />}
      mobileHeader={<MobileBackBar title="Đặt lại mật khẩu" backHref="/login" />}
      mobileBackground="muted"
    >
      <Suspense fallback={<ResetPasswordFallback />}>
        <ResetPasswordPanel />
      </Suspense>
    </AuthSplitLayout>
  );
}
