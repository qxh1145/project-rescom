import { Suspense, type ReactNode } from "react";
import { AppHeader } from "./AppHeader";
import { BottomNav } from "./BottomNav";
import { SessionGate } from "./SessionGate";

/**
 * Signed-in app frame: desktop header (≥ lg) or mobile bottom nav (< lg).
 * Pages render their own mobile top bar (`MobileTopBar.tsx`) because it
 * differs per screen in Figma. Used by `app/(signed-in)/(app)/layout.tsx`;
 * the `SessionProvider` comes from `app/(signed-in)/layout.tsx`.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <SessionGate>
        <div className="flex min-h-dvh flex-col bg-surface-muted">
          <AppHeader />
          <main className="flex-1 pb-[calc(62px+env(safe-area-inset-bottom))] lg:pb-0">{children}</main>
          <BottomNav />
        </div>
      </SessionGate>
    </Suspense>
  );
}

/**
 * Focused flows (survey taking, onboarding, top-up steps): session, no app
 * chrome. Used by `app/(signed-in)/(focus)/layout.tsx`.
 */
export function FocusShell({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <SessionGate>
        <div className="flex min-h-dvh flex-col bg-surface-muted">{children}</div>
      </SessionGate>
    </Suspense>
  );
}
