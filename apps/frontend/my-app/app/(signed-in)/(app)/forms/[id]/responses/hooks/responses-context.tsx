"use client";

import { useParams, useSearchParams } from "next/navigation";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useApiQuery } from "@/lib/api/use-api-query";
import type { ApiError } from "@/lib/api/api-error";
import { getFormResponses, type FormResponses } from "@/lib/forms/results-service";
import { MOBILE_INITIAL_COUNT, normalizeColumnIds } from "@/lib/forms/results-view";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

interface ResponsesContextValue {
  formId: string;
  data: FormResponses | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
  /** Question ids shown as table columns ("Cột · 3/8 câu"); kept while moving between rows. */
  columnIds: string[];
  setColumnIds: (ids: string[]) => void;
  /** Mobile cards shown so far ("Xem thêm N câu trả lời"). */
  mobileVisible: number;
  setMobileVisible: (count: number) => void;
}

const ResponsesContext = createContext<ResponsesContextValue | null>(null);

/**
 * Loads `GET /forms/:id/responses` once for `/responses` and every
 * `/responses/:responseId` (mounted by `responses/layout.tsx`), so opening a
 * row does not refetch. `?v=` selects the version (17a "Câu trả lời" link).
 */
export function ResponsesProvider({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const version = Number(search.get("v")) || null;
  const query = useApiQuery(`form-responses:${id}:${version ?? ""}`, (signal) => getFormResponses(id, version, signal));
  const sessionLost = useSessionLossRedirect(query.error);
  const [chosenColumns, setColumnIds] = useState<string[]>([]);
  const [mobileVisible, setMobileVisible] = useState(MOBILE_INITIAL_COUNT);
  const data = query.data ?? null;
  const columnIds = useMemo(
    () => (data ? normalizeColumnIds(data.questions, chosenColumns) : []),
    [data, chosenColumns],
  );

  const value = useMemo<ResponsesContextValue>(
    () => ({
      formId: id,
      data,
      error: sessionLost ? null : query.error,
      loading: query.loading || sessionLost,
      reload: query.reload,
      columnIds,
      setColumnIds,
      mobileVisible,
      setMobileVisible,
    }),
    [id, data, sessionLost, query.error, query.loading, query.reload, columnIds, mobileVisible],
  );
  return <ResponsesContext.Provider value={value}>{children}</ResponsesContext.Provider>;
}

export function useResponses(): ResponsesContextValue {
  const value = useContext(ResponsesContext);
  if (!value) throw new Error("useResponses must be used inside <ResponsesProvider>");
  return value;
}
