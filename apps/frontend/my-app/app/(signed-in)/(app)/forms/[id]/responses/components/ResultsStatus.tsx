import type { ReactNode } from "react";
import { Mascot } from "@/components/brand/Mascot";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";

/** Loading / error / empty blocks shared by the 5C result tabs (responses, quality, versions). */

export function ResultsLoading({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-3 py-16 text-body text-ink-muted" role="status" aria-busy="true">
      <Spinner className="size-5 text-primary" />
      {label}
    </p>
  );
}

export function ResultsError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <Alert tone="danger" className="flex-1">
        {message}
      </Alert>
      <Button variant="secondary" size="base" radius="field" onClick={onRetry}>
        Thử lại
      </Button>
    </div>
  );
}

/** ASSUMED: empty states are not drawn for 5C; built from the Figma empty-state pattern (mascot + title + hint). */
export function ResultsEmpty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <section className="flex flex-col items-center gap-3 rounded-[22px] border border-line bg-surface px-6 py-12 text-center">
      <Mascot name="wait" height={120} />
      <h2 className="text-[18px] font-extrabold text-ink">{title}</h2>
      {children ? <p className="max-w-[420px] text-body-sm text-ink-muted">{children}</p> : null}
      {action}
    </section>
  );
}
