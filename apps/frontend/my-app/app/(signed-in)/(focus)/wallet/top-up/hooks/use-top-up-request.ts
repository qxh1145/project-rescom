"use client";

import { useParams } from "next/navigation";
import { useApiQuery } from "@/lib/api/use-api-query";
import { useSessionLossRedirect } from "@/lib/session/use-session-loss";
import { getMyTopUpRequest } from "@/lib/wallet/top-up-service";

/** The request of `/wallet/top-up/[id]` (14b) and `/wallet/top-up/[id]/pending` (14c). */
export function useTopUpRequest() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const query = useApiQuery(id ? `top-up:${id}` : null, (signal) => getMyTopUpRequest(id, signal));
  // 401 / locked account: SessionGate redirects; keep the loading state meanwhile.
  const sessionLost = useSessionLossRedirect(query.error);
  return { id, request: query.data ?? null, error: sessionLost ? null : query.error, reload: query.reload };
}
