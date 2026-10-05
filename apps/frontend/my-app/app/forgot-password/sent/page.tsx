import type { Metadata } from "next";
import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { AuthHero } from "../../login/components/AuthHero";
import { AuthSplitLayout } from "../../login/components/AuthSplitLayout";
import { ResetLinkSentPanel } from "../components/ResetLinkSentPanel";

export const metadata: Metadata = {
  title: "Kiểm tra hộp thư — Rescom",
};

/** Figma `63:2089` "15c · Đã gửi link đặt lại · Mobile". Desktop ASSUMED (design) (split layout + card). */
export default function ResetLinkSentPage() {
  return (
    <AuthSplitLayout
      hero={<AuthHero showSteps={false} />}
      mobileHeader={<MobileBackBar title="Kiểm tra hộp thư" backHref="/forgot-password" />}
      mobileBackground="muted"
    >
      <ResetLinkSentPanel />
    </AuthSplitLayout>
  );
}
