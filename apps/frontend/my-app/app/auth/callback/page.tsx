import { Suspense } from "react";
import type { Metadata } from "next";
import { AuthCallbackHandler, AuthCallbackStatus } from "./AuthCallbackHandler";

export const metadata: Metadata = {
  title: "Đang đăng nhập | Rescom",
};

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<AuthCallbackStatus />}>
      <AuthCallbackHandler />
    </Suspense>
  );
}
