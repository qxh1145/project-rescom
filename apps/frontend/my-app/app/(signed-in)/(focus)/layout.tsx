import type { ReactNode } from "react";
import { FocusShell } from "@/components/layout/app/AppShell";

/** Signed-in focused flows without app navigation (Figma draws their own headers). */
export default function FocusLayout({ children }: { children: ReactNode }) {
  return <FocusShell>{children}</FocusShell>;
}
