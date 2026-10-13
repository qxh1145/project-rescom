import type { Metadata } from "next";
import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { AuthHero } from "../../login/components/AuthHero";
import { AuthSplitLayout } from "../../login/components/AuthSplitLayout";
import { LinkGooglePanel } from "./components/LinkGooglePanel";

export const metadata: Metadata = {
  title: "Liên kết tài khoản | Rescom",
};

/**
 * Figma `63:2192` "15d · Liên kết Google với tài khoản có sẵn · Mobile".
 * Desktop ASSUMED (split layout + card). Entry: `/auth/error?error=AUTH_GOOGLE_LINK_REQUIRED`.
 */
export default function LinkGooglePage() {
  return (
    <AuthSplitLayout
      hero={<AuthHero showSteps={false} />}
      mobileHeader={<MobileBackBar title="Liên kết tài khoản" backHref="/login" />}
      mobileBackground="muted"
    >
      <LinkGooglePanel />
    </AuthSplitLayout>
  );
}
