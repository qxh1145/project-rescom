import type { ReactNode } from "react";
import { AuthHero } from "./AuthHero";
import { AuthMobileHeader } from "./AuthMobileHeader";

interface AuthSplitLayoutProps {
  children: ReactNode;
  /** Desktop left panel (hidden below `lg`). */
  hero?: ReactNode;
  /** Mobile top section (must hide itself from `lg`): hills header on login, back bar elsewhere. */
  mobileHeader?: ReactNode;
  /** Page 15 mobile frames sit on `surface-muted`; login is white. */
  mobileBackground?: "surface" | "muted";
}

/**
 * Figma desktop `62:106` / `63:3405` (two 720px columns) and the single-column
 * mobile frames (`62:427`, page 15). Breakpoint: `lg` (1024px).
 */
export function AuthSplitLayout({
  children,
  hero = <AuthHero />,
  mobileHeader = <AuthMobileHeader />,
  mobileBackground = "surface",
}: AuthSplitLayoutProps) {
  const background = mobileBackground === "muted" ? "bg-surface-muted lg:bg-surface" : "bg-surface";
  return (
    <div
      className={`flex min-h-screen flex-col ${background} [--focus-ring-color:var(--color-primary)] lg:grid lg:grid-cols-2`}
    >
      {hero}
      {mobileHeader}
      {/* Column flex on mobile so a panel can pin actions to the bottom (15c). */}
      <main className="flex flex-1 flex-col lg:flex-row lg:items-center lg:justify-center lg:bg-surface-muted lg:p-10">
        {children}
      </main>
    </div>
  );
}
