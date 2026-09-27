import type { Metadata } from "next";
import { Suspense } from "react";
import { UsersScreen } from "./components/UsersScreen";

export const metadata: Metadata = {
  title: "Người dùng — Rescom Admin",
};

/** `/admin/users[?id=<userId>]` — Figma 11d "Người dùng & khoá tài khoản" (63:2212, desktop only). */
export default function AdminUsersPage() {
  return (
    <Suspense>
      <UsersScreen />
    </Suspense>
  );
}
