import type { Metadata } from "next";
import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { AuthHero } from "../login/components/AuthHero";
import { AuthSplitLayout } from "../login/components/AuthSplitLayout";
import { ForgotPasswordPanel } from "./components/ForgotPasswordPanel";

export const metadata: Metadata = {
  title: "Quên mật khẩu | Rescom",
};

/**
 * Figma `63:1973` "15b · Quên mật khẩu · Mobile". Desktop is not drawn: the
 * register split layout (hero without chips + card) is reused (ASSUMED).
 */
export default function ForgotPasswordPage() {
  return (
    <AuthSplitLayout
      hero={<AuthHero showSteps={false} />}
      mobileHeader={<MobileBackBar title="Quên mật khẩu" backHref="/login" />}
      mobileBackground="muted"
    >
      <ForgotPasswordPanel />
    </AuthSplitLayout>
  );
}
