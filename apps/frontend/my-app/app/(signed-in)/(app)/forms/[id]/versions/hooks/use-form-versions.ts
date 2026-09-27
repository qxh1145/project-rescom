"use client";

import { useMemo } from "react";
import { useApiQuery } from "@/lib/api/use-api-query";
import { getFormVersion, getFormVersions } from "@/lib/forms/results-service";
import { diffVersions, draftAndBase, sortVersionsDesc } from "@/lib/forms/results-versions";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";

/**
 * 17a data: the version list (VERIFIED route), then — when a draft sits on
 * top of a published version — both versions' blocks (ASSUMED route) to list
 * "Thay đổi so với vN".
 */
export function useFormVersions(formId: string) {
  const list = useApiQuery(`form-versions:${formId}`, (signal) => getFormVersions(formId, signal));
  const { draft, base } = useMemo(() => draftAndBase(list.data ?? []), [list.data]);
  const pairKey = draft && base ? `form-version-diff:${formId}:${base.id}:${draft.id}` : null;
  const diff = useApiQuery(pairKey, async (signal) => {
    if (!draft || !base) return [];
    const [previous, next] = await Promise.all([
      getFormVersion(formId, base.id, signal),
      getFormVersion(formId, draft.id, signal),
    ]);
    return diffVersions(previous.schemaJson.blocks, next.schemaJson.blocks);
  });
  const sessionLost = useSessionLossRedirect(list.error, diff.error);

  return {
    versions: list.data ? sortVersionsDesc(list.data) : null,
    error: sessionLost ? null : list.error,
    reload: list.reload,
    draft,
    base,
    changes: diff.data ?? null,
    changesLoading: diff.loading,
    changesFailed: Boolean(diff.error) && !sessionLost,
    reloadChanges: diff.reload,
  };
}
