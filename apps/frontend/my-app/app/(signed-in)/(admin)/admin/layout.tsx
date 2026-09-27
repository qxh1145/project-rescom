import type { ReactNode } from "react";
import { AdminShell } from "@/components/layout/admin/AdminShell";

/** Admin console (Figma page 11): sidebar shell, ADMIN role only. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
