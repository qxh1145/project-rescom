import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthSplitLayout } from "./components/AuthSplitLayout";
import { LoginPanel } from "./components/LoginPanel";

export const metadata: Metadata = {
  title: "Đăng nhập — Rescom",
};

/** Keeps the panel footprint while search params resolve on the client. */
function LoginPanelFallback() {
  return (
    <div
      aria-hidden="true"
      className="mx-auto h-110 w-full max-w-[440px] lg:h-141.5 lg:max-w-[522px] lg:rounded-card lg:border lg:border-line lg:bg-surface"
    />
  );
}

/** Figma page `55:3` "1 · Đăng nhập / Đăng ký". */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Legacy register mode (`?mode=register`, `?tab=register` from PublicShell) → dedicated screen.
  const { mode, tab, returnTo } = await searchParams;
  if (mode === "register" || tab === "register") {
    redirect(typeof returnTo === "string" ? `/register?${new URLSearchParams({ returnTo })}` : "/register");
  }

  return (
    <AuthSplitLayout>
      <Suspense fallback={<LoginPanelFallback />}>
        <LoginPanel />
      </Suspense>
    </AuthSplitLayout>
  );
}
