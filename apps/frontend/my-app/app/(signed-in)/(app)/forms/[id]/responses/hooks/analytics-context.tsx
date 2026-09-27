"use client";

import { useParams, useSearchParams, useSelectedLayoutSegment } from "next/navigation";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useApiQuery } from "@/lib/api/use-api-query";
import type { ApiError } from "@/lib/api/api-error";
import { getFormAnalytics, type FormAnalytics } from "@/lib/forms/results-analytics-service";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

interface AnalyticsContextValue {
  formId: string;
  /** `?v=` of the page; null = the current version. */
  version: number | null;
  data: FormAnalytics | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

const AnalyticsContext = createContext<AnalyticsContextValue | null>(null);

/** Child segments of `responses/` that show analytics: Tóm tắt (none) and Theo câu hỏi. */
export function isAnalyticsSegment(segment: string | null): boolean {
  return segment === null || segment === "questions";
}

/**
 * Loads `GET /forms/:id/analytics` once for Tóm tắt and Theo câu hỏi
 * (mounted by `responses/layout.tsx`), so switching between them does not
 * refetch. Skipped on Từng câu trả lời and a response detail.
 */
export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const segment = useSelectedLayoutSegment();
  const version = Number(search.get("v")) || null;
  const query = useApiQuery(isAnalyticsSegment(segment) ? `form-analytics:${id}:${version ?? ""}` : null, (signal) =>
    getFormAnalytics(id, version, signal),
  );
  const sessionLost = useSessionLossRedirect(query.error);

  const value = useMemo<AnalyticsContextValue>(
    () => ({
      formId: id,
      version,
      data: query.data ?? null,
      error: sessionLost ? null : query.error,
      loading: query.loading || sessionLost,
      reload: query.reload,
    }),
    [id, version, query.data, sessionLost, query.error, query.loading, query.reload],
  );
  return <AnalyticsContext.Provider value={value}>{children}</AnalyticsContext.Provider>;
}

export function useAnalytics(): AnalyticsContextValue {
  const value = useContext(AnalyticsContext);
  if (!value) throw new Error("useAnalytics must be used inside <AnalyticsProvider>");
  return value;
}
