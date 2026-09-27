"use client";

import Link from "next/link";
import { useParams, useSelectedLayoutSegment } from "next/navigation";
import type { ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { IconLink } from "@/components/ui/IconButton";
import { Spinner } from "@/components/ui/Spinner";
import { FormHeaderProvider, useFormHeader } from "@/lib/forms/manage-header-context";
import { formLoadErrorMessage } from "@/lib/forms/manage-messages";
import { statusViewOf } from "@/lib/forms/manage-status";
import { headerMeta } from "@/lib/forms/manage-view";
import { StatusPill } from "../../components/StatusPill";
import { FormActionsProvider, useFormActions } from "../hooks/use-form-actions";
import { HeaderActions } from "./HeaderActions";
import { SurveyTabs, type SurveyTab } from "./SurveyTabs";

/**
 * Child segments that get the survey header + tabs. Anything else under
 * `/forms/[id]` (the full-screen Form Builder `builder`, `export`, 5A's
 * `submitted`) renders bare, but can still read `useFormHeader()`.
 */
const TAB_OF_SEGMENT: Record<string, SurveyTab> = {
  "": "progress",
  reopen: "progress",
  resubmit: "progress",
  complaints: "progress",
  responses: "responses",
  quality: "quality",
  versions: "versions",
};

function SurveyChrome({ tab, children }: { tab: SurveyTab; children: ReactNode }) {
  const { form, error, loading, reload } = useFormHeader();
  const actions = useFormActions();

  if (!form) {
    return (
      <div className="mx-auto w-full max-w-[1440px] px-5 pt-6 pb-8 lg:px-12 lg:pt-8">
        <Link href="/forms" className="text-caption font-semibold text-primary">
          ← Khảo sát của tôi
        </Link>
        {error ? (
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
            <Alert tone="danger" className="flex-1">
              {formLoadErrorMessage(error)}
            </Alert>
            <Button variant="secondary" size="base" radius="field" onClick={reload}>
              Thử lại
            </Button>
          </div>
        ) : (
          <p className="flex items-center gap-3 py-16 text-body text-ink-muted" role="status" aria-busy={loading}>
            <Spinner className="size-5 text-primary" />
            Đang tải khảo sát…
          </p>
        )}
      </div>
    );
  }

  const view = statusViewOf(form);
  return (
    <>
      {/* Mobile header (Figma 62:3293): back to the list, title + short meta. */}
      <header className="sticky top-0 z-30 bg-surface pt-[max(env(safe-area-inset-top),8px)] lg:hidden">
        <div className="flex min-h-15 items-center gap-3 px-5 pb-2">
          <IconLink href="/forms" icon="chevron-left" label="Quay lại Khảo sát của tôi" />
          <div className="min-w-0">
            <h1 className="truncate text-body font-bold text-ink">{form.title}</h1>
            <p className="truncate text-[12px] text-ink-muted">{headerMeta(form, true)}</p>
          </div>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[1440px] lg:px-12 lg:pt-6.5">
        {/* Desktop header (Figma 62:2583–62:2602, 63:4720–63:4734). */}
        <div className="hidden lg:block">
          <nav aria-label="Breadcrumb" className="text-caption">
            <Link href="/forms" className="font-semibold text-primary hover:underline">
              Khảo sát của tôi
            </Link>
            <span className="text-ink-muted"> / {tab === "progress" ? "Theo dõi" : "Kết quả"}</span>
          </nav>
          <div className="mt-2 flex items-end justify-between gap-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-[28px] font-extrabold tracking-[-0.3px] text-ink">{form.title}</h1>
                <StatusPill view={view} size="md" />
              </div>
              <p className="mt-1.5 text-body-sm text-ink-muted">{headerMeta(form)}</p>
            </div>
            <HeaderActions form={form} className="shrink-0 justify-end" tourTarget="form-actions" />
          </div>
        </div>

        <div className="lg:mt-5">
          <SurveyTabs form={form} active={tab} />
        </div>

        {/* Mobile: the Tiến độ tab renders its own owner actions from `form` (ProgressScreen,
            Figma 62:3324, shown regardless of progress loading/error state); other tabs get
            them here. ASSUMED. */}
        {tab !== "progress" ? <HeaderActions form={form} className="px-5 pt-4 lg:hidden" /> : null}

        {actions.error ? (
          <Alert tone="danger" onDismiss={actions.dismissError} className="mx-5 mt-4 lg:mx-0">
            {actions.error}
          </Alert>
        ) : null}
      </div>

      {children}
    </>
  );
}

/**
 * `/forms/[id]/*` frame: loads the survey once (`useFormHeader`) and renders
 * the shared header + tab nav for the tab routes only.
 */
export function FormWorkspace({ children }: { children: ReactNode }) {
  const params = useParams<{ id: string }>();
  const segment = useSelectedLayoutSegment();
  const tab = TAB_OF_SEGMENT[segment ?? ""];

  return (
    <FormHeaderProvider formId={params.id}>
      <FormActionsProvider>{tab ? <SurveyChrome tab={tab}>{children}</SurveyChrome> : children}</FormActionsProvider>
    </FormHeaderProvider>
  );
}
