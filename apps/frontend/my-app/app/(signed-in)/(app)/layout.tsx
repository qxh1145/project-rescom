import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app/AppShell";

/** Screens with the app header (desktop) and bottom nav (mobile). */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
