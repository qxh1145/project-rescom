"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ApiError } from "../api/api-error.ts";
import { useApiQuery } from "../api/use-api-query.ts";
import { useSessionLossRedirect } from "../session/use-session-loss.ts";
import { getPublisherForm, type PublisherForm } from "./manage-service.ts";

/**
 * The survey shown by `app/(signed-in)/(app)/forms/[id]/layout.tsx`: one
 * `GET /forms/:id` shared by the header and every tab (Tiến độ, Câu trả lời,
 * Chất lượng, Phiên bản) so they never refetch it.
 */
export interface FormHeaderState {
  formId: string;
  /** Undefined while loading or after a failed first load. */
  form: PublisherForm | undefined;
  error: ApiError | null;
  loading: boolean;
  /** Refetch the survey (keeps the current one visible). */
  reload: () => void;
  /**
   * Bumped after every close / reopen / pause: tab screens add it to their
   * own query keys to refetch data the change affected.
   */
  revision: number;
  /** Replace the survey with the one a mutation returned, then bump `revision`. */
  applyForm: (form: PublisherForm) => void;
  /** Bump `revision` after a change that leaves the survey itself unchanged (e.g. a dispute). */
  invalidate: () => void;
}

const FormHeaderContext = createContext<FormHeaderState | null>(null);

export function FormHeaderProvider({ formId, children }: { formId: string; children: ReactNode }) {
  const query = useApiQuery(`publisher-form:${formId}`, (signal) => getPublisherForm(formId, signal));
  const [revision, setRevision] = useState(0);
  // 401 / locked account: SessionGate redirects instead of showing an error.
  const sessionLost = useSessionLossRedirect(query.error);
  const { setData, reload } = query;

  const applyForm = useCallback(
    (form: PublisherForm) => {
      setData(() => form);
      setRevision((current) => current + 1);
    },
    [setData],
  );

  const invalidate = useCallback(() => setRevision((current) => current + 1), []);

  const value = useMemo<FormHeaderState>(
    () => ({
      formId,
      form: query.data,
      error: sessionLost ? null : query.error,
      loading: query.loading || sessionLost,
      reload,
      revision,
      applyForm,
      invalidate,
    }),
    [formId, query.data, query.error, query.loading, sessionLost, reload, revision, applyForm, invalidate],
  );

  return <FormHeaderContext.Provider value={value}>{children}</FormHeaderContext.Provider>;
}

/** Survey header state; only inside `/forms/[id]/*` (throws elsewhere). */
export function useFormHeader(): FormHeaderState {
  const value = useContext(FormHeaderContext);
  if (!value) throw new Error("useFormHeader must be used inside app/(signed-in)/(app)/forms/[id]/layout.tsx");
  return value;
}
