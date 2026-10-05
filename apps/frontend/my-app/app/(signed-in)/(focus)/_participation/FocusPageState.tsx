import Link from "next/link";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

/**
 * Full-page loading / error states shared by the Phase 3B focus screens
 * (start, taking, complete). ASSUMED (design): not drawn in Figma; page 8 states.
 */
export function FocusLoading({ label = "Đang tải…" }: { label?: string }) {
  return (
    <main className="flex flex-1 items-center justify-center px-5 py-16" aria-busy="true">
      <p className="flex items-center gap-3 text-body text-ink-muted" role="status">
        <Spinner className="size-5 text-primary" />
        {label}
      </p>
    </main>
  );
}

interface FocusErrorProps {
  title?: string;
  message: string;
  /** `info` for a final answer (e.g. "already completed"); pair it with no `onRetry`. */
  tone?: "danger" | "info";
  onRetry?: () => void;
  backHref?: string;
  backLabel?: string;
  children?: ReactNode;
}

export function FocusError({
  title = "Chưa mở được trang này",
  message,
  tone = "danger",
  onRetry,
  backHref = "/marketplace",
  backLabel = "Về Khám phá",
  children,
}: FocusErrorProps) {
  return (
    <main className="flex flex-1 items-start justify-center px-5 py-10 lg:items-center">
      <section className="flex w-full max-w-[480px] flex-col gap-4 rounded-card border border-line bg-surface p-6 lg:p-8">
        <h1 className="text-[22px] font-extrabold text-ink">{title}</h1>
        <Alert tone={tone}>{message}</Alert>
        {children}
        <div className="flex flex-wrap gap-3">
          <Link href={backHref} className={buttonClassName({ variant: "secondary", size: "base", radius: "field" })}>
            {backLabel}
          </Link>
          {onRetry ? (
            <Button size="base" radius="field" onClick={onRetry}>
              Thử lại
            </Button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
