import type { ReactNode } from "react";

interface AuthCardProps {
  /**
   * Desktop card title. Mobile shows it in the back bar instead, so it is hidden
   * there. Omit when the content carries its own visible heading.
   */
  title?: string;
  subtitle?: string;
  /** Vertical rhythm: 16px (register `63:3432`) or 18px (15b/15d mobile frames). */
  spacing?: "md" | "lg";
  className?: string;
  children: ReactNode;
}

/**
 * Right-hand form card of the page 15 auth screens: white 542px card on
 * desktop (`63:3432`), bare 20px-gutter column on mobile.
 */
export function AuthCard({ title, subtitle, spacing = "md", className = "", children }: AuthCardProps) {
  return (
    <div
      className={`mx-auto flex w-full max-w-[440px] flex-col px-5 pb-8 pt-5 lg:max-w-[542px] lg:rounded-card lg:border lg:border-line lg:bg-surface lg:p-10 ${
        spacing === "lg" ? "gap-4.5" : "gap-4"
      } ${className}`}
    >
      {title ? (
        <div className="hidden lg:block">
          <h2 className="text-title font-extrabold text-ink">{title}</h2>
          {subtitle ? <p className="mt-1.5 text-body text-ink-muted">{subtitle}</p> : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}
