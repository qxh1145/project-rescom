import { Suspense } from "react";
import type { Metadata } from "next";
import { MobileBackBar } from "@/components/layout/app/MobileTopBar";
import { AuthHero } from "../login/components/AuthHero";
import { AuthSplitLayout } from "../login/components/AuthSplitLayout";
import { RegisterPanel } from "./components/RegisterPanel";

export const metadata: Metadata = {
  title: "Tạo tài khoản — Rescom",
};

/** Keeps the card footprint while search params resolve on the client. */
function RegisterPanelFallback() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto h-170 w-full max-w-[440px] lg:h-173 lg:max-w-[542px] lg:rounded-card lg:border lg:border-line lg:bg-surface"
    />
  );
}

/** Figma page `55:17` "15 · Tài khoản": `63:3405` (desktop) / `63:4184` (mobile). */
export default function RegisterPage() {
  return (
    <AuthSplitLayout
      hero={
        <AuthHero
          description="Tạo tài khoản để làm khảo sát nhận điểm, rồi dùng điểm tìm người trả lời cho nghiên cứu của bạn."
          showSteps={false}
        />
      }
      mobileHeader={<MobileBackBar title="Tạo tài khoản" backHref="/login" />}
      mobileBackground="muted"
    >
      <Suspense fallback={<RegisterPanelFallback />}>
        <RegisterPanel />
      </Suspense>
    </AuthSplitLayout>
  );
}
